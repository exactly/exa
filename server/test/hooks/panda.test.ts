import "../mocks/deployments";
import "../mocks/keeper";
import "../mocks/onesignal";
import "../mocks/panda";
import "../mocks/redis";
import "../mocks/sardine";
import "../mocks/sentry";

import { captureException, setContext, setTag, setUser, startSpan } from "@sentry/node";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { parse } from "valibot";
import {
  BaseError,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  hexToBigInt,
  http,
  padHex,
  zeroAddress,
  zeroHash,
  type Hex,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain, {
  auditorAbi,
  exaAccountFactoryAbi,
  exaPluginAbi,
  issuerCheckerAbi,
  marketAbi,
  marketUSDCAddress,
  usdcAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import ProposalType from "@exactly/common/ProposalType";
import { Address } from "@exactly/common/validation";
import { proposalManager } from "@exactly/plugin/deploy.json";

import database, { cards, credentials, transactions } from "../../database";
import app from "../../hooks/panda";
import keeper from "../../utils/keeper";
import * as onesignal from "../../utils/onesignal";
import * as panda from "../../utils/panda";
import { collectors } from "../../utils/panda";
import publicClient from "../../utils/publicClient";
import * as sardine from "../../utils/sardine";
import * as segment from "../../utils/segment";
import traceClient from "../../utils/traceClient";
import anvilClient from "../anvilClient";

const appClient = testClient(app);
const owner = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(generatePrivateKey()) });
const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(owner.account.address), y: zeroHash });

beforeAll(async () => {
  await Promise.all([
    database.transaction(async (tx) => {
      await tx
        .insert(credentials)
        .values([{ id: "cred", publicKey: new Uint8Array(), account, factory: inject("ExaAccountFactory") }]);
      await tx.insert(cards).values([{ id: "card", credentialId: "cred", lastFour: "1234" }]);
    }),
    anvilClient.setBalance({ address: owner.account.address, value: 10n ** 24n }),
  ]);
});

describe("validation", () => {
  it("fails with bad key", async () => {
    const response = await appClient.index.$post({ ...authorization, header: { signature: "bad" } });

    expect(response.status).toBe(401);
  });
});

describe("card operations", () => {
  beforeAll(async () => {
    await Promise.all([
      keeper.exaSend(
        { name: "create account", op: "exa.account" },
        {
          address: inject("ExaAccountFactory"),
          abi: exaAccountFactoryAbi,
          functionName: "createAccount",
          args: [0n, [{ x: hexToBigInt(owner.account.address), y: 0n }]],
        },
      ),
      keeper.exaSend(
        { name: "mint usdc", op: "tx.mint" },
        { address: inject("USDC"), abi: mockERC20Abi, functionName: "mint", args: [inject("Refunder"), 100_000_000n] },
      ),
    ]);
  });

  describe("authorization", () => {
    describe("with collateral", () => {
      beforeAll(async () => {
        await keeper.exaSend(
          { name: "mint usdc", op: "tx.mint" },
          { address: inject("USDC"), abi: mockERC20Abi, functionName: "mint", args: [account, 420_000_000n] },
        );
        await keeper.exaSend(
          { name: "poke", op: "exa.poke" },
          { address: account, abi: exaPluginAbi, functionName: "poke", args: [inject("MarketUSDC")] },
        );
      });

      afterEach(() => panda.getMutex(account)?.release());

      it("fails with InsufficientAccountLiquidity", async () => {
        const currentFunds = await publicClient
          .readContract({
            address: inject("MarketUSDC"),
            abi: marketAbi,
            functionName: "balanceOf",
            args: [account],
          })
          .then((shares) => {
            return publicClient.readContract({
              address: inject("MarketUSDC"),
              abi: marketAbi,
              functionName: "convertToAssets",
              args: [shares],
            });
          });

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              spend: { ...authorization.json.body.spend, cardId: "card", amount: Number(currentFunds) / 1e4 + 100 },
            },
          },
        });

        expect(response.status).toBe(557);
        expect(captureException).not.toHaveBeenCalled();
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "AuthorizationRejected",
            properties: expect.objectContaining({ declinedReason: "panda-error" }),
          }),
        );
      });

      it("fails with replay", async () => {
        vi.spyOn(traceClient, "traceCall").mockResolvedValue({
          ...callFrame,
          output: encodeErrorResult({ abi: issuerCheckerAbi, errorName: "Replay" }),
        });

        await database.insert(cards).values([{ id: "replay", credentialId: "cred", lastFour: "2222", mode: 4 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "replay" } },
          },
        });

        expect(response.status).toBe(558);
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "Replay" }),
          expect.objectContaining({ level: "error", tags: { unhandled: true } }),
        );
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "AuthorizationRejected",
            properties: expect.objectContaining({ declinedReason: expect.stringContaining("reverted") }),
          }),
        );
      });

      it("fails with bad panda", async () => {
        const response = await appClient.index.$post({
          ...authorization,
          json: {} as unknown as typeof authorization.json,
        });

        expect(response.status).not.toBe(200);
        expect(captureException).toHaveBeenCalledWith(new Error("bad panda"), expect.anything());
      });

      it("returns 404 when card not found in authorization", async () => {
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              spend: { ...authorization.json.body.spend, cardId: "nonexistent-auth-card" },
            },
          },
        });

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toStrictEqual({ code: "card not found" });
      });

      it("throws on mutex acquire with non-timeout error", async () => {
        const error = new Error("broken");
        vi.spyOn(panda, "getMutex").mockReturnValueOnce(undefined);
        vi.spyOn(panda, "createMutex").mockReturnValueOnce({
          acquire: () => Promise.reject(error),
          release: vi.fn(),
          isLocked: () => false,
          cancel: vi.fn(),
          waitForUnlock: vi.fn(),
        } as unknown as ReturnType<typeof panda.createMutex>);
        await database
          .insert(cards)
          .values([{ id: "mutex-err", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "mutex-err" } },
          },
        });

        expect(response.status).toBe(500);
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "AuthorizationRejected",
            properties: expect.objectContaining({ declinedReason: "unknown-error" }),
          }),
        );
      });

      it("authorizes credit", async () => {
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "card" } },
          },
        });

        expect(response.status).toBe(200);
        expect(setUser).toHaveBeenCalledWith({ id: account });
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: account,
            event: "TransactionAuthorized",
            properties: expect.objectContaining({ type: "panda", cardMode: 0, usdAmount: 9 }),
          }),
        );
      });

      it("authorizes debit", async () => {
        await database.insert(cards).values([{ id: "debit", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "debit" } },
          },
        });

        expect(response.status).toBe(200);
        expect(setUser).toHaveBeenCalledWith({ id: account });
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: account,
            event: "TransactionAuthorized",
            properties: expect.objectContaining({ type: "panda", cardMode: 0, usdAmount: 9 }),
          }),
        );
      });

      it("authorizes debit when risk assessment times out", async () => {
        const error = new Error("timeout");
        error.name = "TimeoutError";
        vi.spyOn(sardine, "default").mockRejectedValueOnce(error);
        await database.insert(cards).values([{ id: "risk-timeout", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "risk-timeout" } },
          },
        });
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "timeout", name: "TimeoutError" }),
          expect.anything(),
        );
        expect(response.status).toBe(200);
      });

      it("authorizes debit when risk assessment fails with non-timeout error", async () => {
        vi.spyOn(sardine, "default").mockRejectedValueOnce(new Error("network"));
        await database
          .insert(cards)
          .values([{ id: "risk-network", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "risk-network" } },
          },
        });

        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "network" }),
          expect.objectContaining({ level: "error" }),
        );
        expect(response.status).toBe(200);
      });

      it("authorizes installments", async () => {
        await database.insert(cards).values([{ id: "inst", credentialId: "cred", lastFour: "5678", mode: 6 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "inst" } },
          },
        });

        expect(response.status).toBe(200);
        expect(setUser).toHaveBeenCalledWith({ id: account });
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: account,
            event: "TransactionAuthorized",
            properties: expect.objectContaining({ type: "panda", cardMode: 6, usdAmount: 9 }),
          }),
        );
      });

      it("authorizes zero", async () => {
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              spend: { ...authorization.json.body.spend, cardId: "card", amount: 0 },
            },
          },
        });

        expect(response.status).toBe(200);
        expect(setUser).toHaveBeenCalledWith({ id: account });
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: account,
            event: "TransactionAuthorized",
            properties: expect.objectContaining({ type: "panda", cardMode: 0, usdAmount: 0 }),
          }),
        );
      });

      it("authorizes negative amount", async () => {
        const feedback = vi.spyOn(sardine, "feedback");
        const authorizationResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              spend: { ...authorization.json.body.spend, cardId: "card", amount: -100 },
            },
          },
        });

        const confirmationResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: "authorization-negative-amount",
              spend: { ...authorization.json.body.spend, cardId: "card", amount: -100, status: "pending" },
            },
          },
        });

        expect(authorizationResponse.status).toBe(200);
        expect(confirmationResponse.status).toBe(200);
        expect(feedback).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: "issuing",
            customer: { id: "cred" },
            transaction: { id: "authorization-negative-amount" },
            feedback: { type: "authorization", status: "approved" },
          }),
        );
      });

      it("fails when tracing", async () => {
        const trace = vi.spyOn(traceClient, "traceCall").mockResolvedValue({
          ...callFrame,
          output: encodeErrorResult({
            abi: [{ type: "error", name: "Panic", inputs: [{ type: "uint256", name: "reason" }] }],
            errorName: "Panic",
            args: [0x11n],
          }),
        });

        await database.insert(cards).values([{ id: "failed_trace", credentialId: "cred", lastFour: "2222", mode: 4 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "failed_trace" } },
          },
        });

        expect(trace).toHaveBeenCalledOnce();
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "collectCredit" }),
          expect.objectContaining({
            fingerprint: ["{{ default }}", "Panic"],
          }),
        );
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "tx reverted" }),
          expect.objectContaining({ level: "error", tags: { unhandled: true } }),
        );
        expect(response.status).toBe(550);
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "AuthorizationRejected",
            properties: expect.objectContaining({
              declinedReason: expect.stringContaining("Arithmetic operation resulted in underflow or overflow"),
            }),
          }),
        );
      });

      it("alarms high risk authorization", async () => {
        vi.spyOn(sardine, "default").mockResolvedValueOnce({
          status: "Success",
          level: "high",
          sessionKey: "123",
          amlLevel: "high",
          score: 98,
          reasonCodes: ["AR01"],
        });
        await database.insert(cards).values([{ id: "high-risk", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "high-risk" } },
          },
        });

        expect(captureException).toHaveBeenCalledWith(new Error("high risk authorization"), expect.anything());

        expect(response.status).toBe(200);
      });

      it("alarms high risk verification", async () => {
        vi.spyOn(sardine, "default").mockResolvedValueOnce({
          status: "Success",
          level: "high",
          sessionKey: "123",
          amlLevel: "high",
          score: 98,
          reasonCodes: ["AR01"],
        });
        await database
          .insert(cards)
          .values([{ id: "high-risk-verifications", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              spend: { ...authorization.json.body.spend, cardId: "high-risk-verifications", amount: 0 },
            },
          },
        });

        expect(captureException).toHaveBeenCalledWith(new Error("high risk verification"), expect.anything());

        expect(response.status).toBe(200);
      });

      it("alarms high risk refund", async () => {
        vi.spyOn(sardine, "default").mockResolvedValueOnce({
          status: "Success",
          level: "high",
          sessionKey: "123",
          amlLevel: "high",
          score: 98,
          reasonCodes: ["AR01"],
        });
        await database
          .insert(cards)
          .values([{ id: "high-risk-refund", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              spend: { ...authorization.json.body.spend, cardId: "high-risk-refund", amount: -100 },
            },
          },
        });

        expect(captureException).toHaveBeenCalledWith(new Error("high risk refund"), expect.anything());

        expect(response.status).toBe(200);
      });

      it("catches fire-and-forget risk assessment error for refund", async () => {
        const error = new Error("risk crash");
        vi.spyOn(sardine, "default").mockImplementationOnce(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          throw error;
        });
        await database
          .insert(cards)
          .values([{ id: "risk-ff-refund", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              spend: { ...authorization.json.body.spend, cardId: "risk-ff-refund", amount: -100 },
            },
          },
        });

        expect(response.status).toBe(200);
        await vi.waitFor(() =>
          expect(captureException).toHaveBeenCalledWith(error, expect.objectContaining({ level: "error" })),
        );
      });

      it("fingerprints by signature when error has no reason or name", async () => {
        vi.spyOn(traceClient, "traceCall").mockResolvedValue({ ...callFrame, output: "0xdeadbeef" as Hex });
        await database
          .insert(cards)
          .values([{ id: "unknown-sig", credentialId: "cred", lastFour: "2222", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "unknown-sig" } },
          },
        });

        expect(response.status).toBe(550);
        expect(captureException).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ fingerprint: ["{{ default }}", "0xdeadbeef"] }),
        );
      });

      it("returns 569 with non-PandaError in authorization catch-all", async () => {
        vi.spyOn(panda, "signIssuerOp").mockRejectedValue("boom");
        await database
          .insert(cards)
          .values([{ id: "ouch", credentialId: "cred", lastFour: "2222", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "ouch" } },
          },
        });

        expect(response.status).toBe(569);
        await expect(response.json()).resolves.toStrictEqual({ code: "ouch" });
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "AuthorizationRejected",
            properties: expect.objectContaining({ declinedReason: "unexpected-error" }),
          }),
        );
        expect(captureException).toHaveBeenCalledWith("boom", expect.objectContaining({ level: "error" }));
      });

      it("fails with bad collection", async () => {
        const [transferTopic] = encodeEventTopics({ abi: erc20Abi, eventName: "Transfer" });
        vi.spyOn(traceClient, "traceCall").mockResolvedValue({
          ...callFrame,
          logs: [
            {
              address: usdcAddress.toLowerCase() as Hex,
              data: encodeAbiParameters([{ type: "uint256" }], [1n]),
              position: "0x0",
              topics: [
                transferTopic,
                padHex(account, { size: 32 }),
                padHex(collectors[0]?.toLowerCase() as Hex, { size: 32 }),
              ],
            },
          ],
        });

        await database.insert(cards).values([{ id: "bad-coll", credentialId: "cred", lastFour: "2222", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "bad-coll" } },
          },
        });

        expect(response.status).toBe(551);
        expect(captureException).toHaveBeenCalledWith(
          new Error("bad collection"),
          expect.objectContaining({ level: "warning" }),
        );
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "AuthorizationRejected",
            properties: expect.objectContaining({ declinedReason: "panda-error" }),
          }),
        );
      });

      it("returns 569 when trace throws unexpected error", async () => {
        vi.spyOn(traceClient, "traceCall").mockRejectedValue(new Error("network failure"));

        await database
          .insert(cards)
          .values([{ id: "trace-error", credentialId: "cred", lastFour: "2222", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "trace-error" } },
          },
        });

        expect(response.status).toBe(569);
        expect(captureException).toHaveBeenCalledWith(
          new Error("network failure"),
          expect.objectContaining({ contexts: expect.objectContaining({ tx: expect.objectContaining({ call: expect.any(Object) }) }) }),
        );
      });

      describe("with drain proposal", () => {
        beforeAll(async () => {
          await execute(
            encodeFunctionData({
              abi: exaPluginAbi,
              functionName: "propose",
              args: [
                inject("MarketUSDC"),
                420_000_000n - 1n,
                ProposalType.Withdraw,
                encodeAbiParameters([{ type: "address" }], [owner.account.address]),
              ],
            }),
          );
        });

        it("declines collection", async () => {
          await database.insert(cards).values([{ id: "drain", credentialId: "cred", lastFour: "5678", mode: 0 }]);

          const response = await appClient.index.$post({
            ...authorization,
            json: {
              ...authorization.json,
              body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "drain" } },
            },
          });

          expect(response.status).toBe(550);
          expect(captureException).toHaveBeenCalledWith(
            expect.objectContaining({ name: "ContractFunctionExecutionError" }),
            expect.objectContaining({ fingerprint: ["{{ default }}", "InsufficientLiquidity"] }),
          );
        });
      });
    });
  });

  describe("clearing", () => {
    describe("with collateral", () => {
      beforeAll(async () => {
        await keeper.exaSend(
          { name: "mint usdc", op: "tx.mint" },
          { address: inject("USDC"), abi: mockERC20Abi, functionName: "mint", args: [account, 420_000_000n] },
        );
        await keeper.exaSend(
          { name: "poke", op: "exa.poke" },
          { address: account, abi: exaPluginAbi, functionName: "poke", args: [inject("MarketUSDC")] },
        );
      });

      it("clears debit", async () => {
        const cardId = "debits";
        await database.insert(cards).values([{ id: "debits", credentialId: "cred", lastFour: "3456", mode: 0 }]);
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId },
            },
          },
        });
        const card = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });
        const purchaseReceipt = await publicClient.waitForTransactionReceipt({
          hash: card?.hashes[0] as Hex,
          confirmations: 0,
        });

        expect(usdcToCollector(purchaseReceipt)).toBe(BigInt(authorization.json.body.spend.amount * 1e4));
        expect(response.status).toBe(200);
        expect(setUser).toHaveBeenCalledWith({ id: account });
        expect(onesignal.sendPushNotification).toHaveBeenCalledWith(
          expect.objectContaining({ headings: { en: "Card purchase" }, contents: expect.objectContaining({ en: expect.stringContaining("with USDC") }) }),
        );
        expect(sardine.feedback).toHaveBeenCalledWith(
          expect.objectContaining({ feedback: { type: "authorization", status: "approved" } }),
        );
      });

      it("clears credit", async () => {
        const amount = 10;

        const cardId = "credits";
        await database.insert(cards).values([{ id: "credits", credentialId: "cred", lastFour: "7890", mode: 1 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount },
            },
          },
        });

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });
        const purchaseReceipt = await publicClient.waitForTransactionReceipt({
          hash: transaction?.hashes[0] as Hex,
          confirmations: 0,
        });

        expect(usdcToCollector(purchaseReceipt)).toBe(BigInt(amount * 1e4));
        expect(response.status).toBe(200);
        expect(setUser).toHaveBeenCalledWith({ id: account });
        expect(onesignal.sendPushNotification).toHaveBeenCalledWith(
          expect.objectContaining({ headings: { en: "Card purchase" }, contents: expect.objectContaining({ en: expect.stringContaining("with credit") }) }),
        );
        expect(sardine.feedback).toHaveBeenCalledWith(
          expect.objectContaining({ feedback: { type: "authorization", status: "approved" } }),
        );
      });

      it("clears with transaction update", async () => {
        const amount = 100;
        const update = 50;
        const createdAt = new Date().toISOString();

        const cardId = "tUpdate";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 1 }]);
        const createResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount, localAmount: amount, authorizedAt: createdAt },
            },
          },
        });

        const updatedAt = new Date(new Date(createdAt).getTime() + 1000 * 30).toISOString();
        const updateResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "updated",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                amount: amount + update,
                authorizationUpdateAmount: update,
                authorizedAt: updatedAt,
                cardId,
                localAmount: amount + update,
              },
            },
          },
        });

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });
        await Promise.all(
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          transaction!.hashes.map((h) => publicClient.waitForTransactionReceipt({ hash: h as Hex, confirmations: 0 })),
        );

        expect(createResponse.status).toBe(200);
        expect(updateResponse.status).toBe(200);

        expect(transaction?.payload).toMatchObject({
          bodies: [
            {
              action: "created",
              createdAt,
              body: {
                spend: {
                  merchantCity: "buenos aires",
                  merchantCountry: "AR",
                  merchantName: "99999",
                },
              },
            },
            { action: "updated", createdAt: updatedAt, body: { spend: { amount: amount + update } } },
          ],
        });
        expect(onesignal.sendPushNotification).toHaveBeenCalledTimes(1);
      });

      it("clears installments", async () => {
        const amount = 120;

        const cardId = "splits";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "6754", mode: 6 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount },
            },
          },
        });

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });
        const purchaseReceipt = await publicClient.waitForTransactionReceipt({
          hash: transaction?.hashes[0] as Hex,
          confirmations: 0,
        });

        expect(usdcToCollector(purchaseReceipt)).toBe(BigInt(amount * 1e4));
        expect(response.status).toBe(200);
        expect(setUser).toHaveBeenCalledWith({ id: account });
        expect(onesignal.sendPushNotification).toHaveBeenCalledWith(
          expect.objectContaining({ headings: { en: "Card purchase" }, contents: expect.objectContaining({ en: expect.stringContaining("in 6 installments") }) }),
        );
        expect(sardine.feedback).toHaveBeenCalledWith(
          expect.objectContaining({ feedback: { type: "authorization", status: "approved" } }),
        );
      });

      it("clears credit when amount is less than installment count", async () => {
        const amount = 3;
        const cardId = "credit-fallback";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "6755", mode: 6 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount },
            },
          },
        });

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });
        const purchaseReceipt = await publicClient.waitForTransactionReceipt({
          hash: transaction?.hashes[0] as Hex,
          confirmations: 0,
        });

        expect(usdcToCollector(purchaseReceipt)).toBe(BigInt(amount * 1e4));
        expect(response.status).toBe(200);
      });

      it("returns 404 when card not found in clearing path", async () => {
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: "no-card-clearing",
              spend: { ...authorization.json.body.spend, cardId: "nonexistent-card", amount: 100 },
            },
          },
        });

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toStrictEqual({ code: "card not found" });
      });

      it("handles declined without declinedReason", async () => {
        await database
          .insert(cards)
          .values([{ id: "declined-noreason", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: "declined-noreason",
              spend: {
                ...authorization.json.body.spend,
                cardId: "declined-noreason",
                amount: 100,
                status: "declined",
              },
            },
          },
        });

        expect(response.status).toBe(200);
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "TransactionRejected",
            properties: expect.objectContaining({ declinedReason: undefined }),
          }),
        );
      });

      it("handles declined with explicit declinedReason", async () => {
        await database
          .insert(cards)
          .values([{ id: "declined-reason", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: "declined-reason",
              spend: {
                ...authorization.json.body.spend,
                cardId: "declined-reason",
                amount: 100,
                status: "declined",
                declinedReason: "insufficient_funds",
              },
            },
          },
        });

        expect(response.status).toBe(200);
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "TransactionRejected",
            properties: expect.objectContaining({ declinedReason: "insufficient_funds" }),
          }),
        );
      });

      it("catches declined feedback error", async () => {
        vi.spyOn(sardine, "feedback").mockRejectedValueOnce(new Error("feedback down"));
        await database
          .insert(cards)
          .values([{ id: "declined-fb", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: "declined-fb",
              spend: {
                ...authorization.json.body.spend,
                cardId: "declined-fb",
                amount: 100,
                status: "declined",
              },
            },
          },
        });

        expect(response.status).toBe(200);
        await vi.waitFor(() =>
          expect(captureException).toHaveBeenCalledWith(
            expect.objectContaining({ message: "feedback down" }),
            expect.objectContaining({ level: "error" }),
          ),
        );
      });

      it("catches negative amount authorization feedback error", async () => {
        vi.spyOn(sardine, "feedback").mockRejectedValueOnce(new Error("feedback neg"));
        await database
          .insert(cards)
          .values([{ id: "neg-fb", credentialId: "cred", lastFour: "5678", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: "neg-fb",
              spend: { ...authorization.json.body.spend, cardId: "neg-fb", amount: -100 },
            },
          },
        });

        expect(response.status).toBe(200);
        await vi.waitFor(() =>
          expect(captureException).toHaveBeenCalledWith(
            expect.objectContaining({ message: "feedback neg" }),
            expect.objectContaining({ level: "error" }),
          ),
        );
      });

      it("catches clearing push notification error", async () => {
        vi.spyOn(onesignal, "sendPushNotification").mockRejectedValueOnce(new Error("push down"));
        const cardId = "push-err";
        const amount = 5;
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "3456", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount, localAmount: amount },
            },
          },
        });

        expect(response.status).toBe(200);
        await vi.waitFor(() =>
          expect(captureException).toHaveBeenCalledWith(
            expect.objectContaining({ message: "push down" }),
            expect.objectContaining({ level: "error" }),
          ),
        );
      });

      it("catches authorization feedback error in clearing", async () => {
        const exaSend = vi.spyOn(keeper, "exaSend").mockImplementation(async (_span, _tx, opts) => {
          await opts?.onHash?.("0xabc" as Hex);
          return {} as Awaited<ReturnType<typeof keeper.exaSend>>;
        });
        vi.spyOn(sardine, "feedback").mockRejectedValueOnce(new Error("fb auth err"));
        const cardId = "fb-auth-err";
        const amount = 5;
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "3456", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount, localAmount: amount },
            },
          },
        });

        expect(response.status).toBe(200);
        expect(exaSend).toHaveBeenCalled();
        await vi.waitFor(() =>
          expect(captureException).toHaveBeenCalledWith(
            expect.objectContaining({ message: "fb auth err" }),
            expect.objectContaining({ level: "error" }),
          ),
        );
      });

      it("catches settlement feedback error", async () => {
        const hold = 5;
        const cardId = "fb-settle-err";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);

        vi.spyOn(keeper, "exaSend").mockImplementation(async (_span, _tx, opts) => {
          await opts?.onHash?.("0xfeed" as Hex);
          return {} as Awaited<ReturnType<typeof keeper.exaSend>>;
        });

        const createResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, amount: hold, cardId, localAmount: hold },
            },
          },
        });
        expect(createResponse.status).toBe(200);
        vi.mocked(keeper.exaSend).mockRestore();

        vi.mocked(sardine.feedback).mockRejectedValueOnce(new Error("fb settle err"));
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                amount: hold,
                authorizedAmount: hold,
                authorizedAt: new Date().toISOString(),
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
              },
            },
          },
        });

        expect(response.status).toBe(200);
        await vi.waitFor(() =>
          expect(captureException).toHaveBeenCalledWith(
            expect.objectContaining({ message: "fb settle err" }),
            expect.objectContaining({ level: "error" }),
          ),
        );
      });

      it("uses nextMaturity without extra interval when far from maturity", async () => {
        const MATURITY_INTERVAL = 2_419_200;
        const now = Math.floor(Date.now() / 1000);
        const lastMaturity = now - (now % MATURITY_INTERVAL);
        const farTimestamp = lastMaturity + 1;
        const cardId = "min-borrow";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "5678", mode: 1 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                cardId,
                amount: 10,
                localAmount: 10,
                authorizedAt: new Date(farTimestamp * 1000).toISOString(),
              },
            },
          },
        });

        expect(response.status).toBe(200);
      });

      it("clears installments when usdAmount >= card.mode", async () => {
        const cardId = "real-inst";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "6789", mode: 3 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount: 400, localAmount: 400 },
            },
          },
        });

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });
        const purchaseReceipt = await publicClient.waitForTransactionReceipt({
          hash: transaction?.hashes[0] as Hex,
          confirmations: 0,
        });

        expect(usdcToCollector(purchaseReceipt)).toBe(BigInt(400 * 1e4));
        expect(response.status).toBe(200);
      });

      it("catches zero-amount feedback error", async () => {
        const hold = 15;
        const cardId = "fb-zero-err";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);

        await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, amount: hold, cardId, localAmount: hold },
            },
          },
        });

        vi.spyOn(sardine, "feedback").mockRejectedValueOnce(new Error("fb zero err"));
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                amount: hold,
                authorizedAmount: hold,
                authorizedAt: new Date().toISOString(),
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
              },
            },
          },
        });

        expect(response.status).toBe(200);
        await vi.waitFor(() =>
          expect(captureException).toHaveBeenCalledWith(
            expect.objectContaining({ message: "fb zero err" }),
            expect.objectContaining({ level: "error" }),
          ),
        );
      });

      it("handles zero-amount settlement with existing transaction", async () => {
        const hold = 50;
        const cardId = "zero-settle";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);

        await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, amount: hold, cardId, localAmount: hold },
            },
          },
        });

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                amount: hold,
                authorizedAmount: hold,
                authorizedAt: new Date().toISOString(),
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
              },
            },
          },
        });

        expect(response.status).toBe(200);
        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });
        expect(transaction?.hashes).toContain(zeroHash);
        expect(sardine.feedback).toHaveBeenCalledWith(
          expect.objectContaining({ feedback: { type: "settlement", status: "settled" } }),
        );
      });

      it("handles zero-amount update with existing transaction", async () => {
        const exaSend = vi.spyOn(keeper, "exaSend").mockImplementationOnce(async (_span, _tx, opts) => {
          await opts?.onHash?.("0xabc" as Hex);
          return {} as Awaited<ReturnType<typeof keeper.exaSend>>;
        });
        const hold = 30;
        const cardId = "zero-update";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);

        await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, amount: hold, cardId, localAmount: hold },
            },
          },
        });
        expect(exaSend).toHaveBeenCalled();

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "updated",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                amount: hold,
                authorizationUpdateAmount: 0,
                authorizedAt: new Date().toISOString(),
                cardId,
                status: "pending",
              },
            },
          },
        });

        expect(response.status).toBe(200);
        expect(sardine.feedback).toHaveBeenCalledWith(
          expect.objectContaining({ feedback: { type: "authorization", status: "approved" } }),
        );
      });

      it("throws when transaction not found in zero-amount path", async () => {
        const cardId = "zero-no-tx";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "updated",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                cardId,
                amount: 100,
                authorizationUpdateAmount: 0,
                authorizedAt: new Date().toISOString(),
                status: "pending",
              },
            },
          },
        });

        expect(response.status).toBe(500);
      });

      it("fails with transaction timeout", async () => {
        vi.spyOn(publicClient, "waitForTransactionReceipt").mockRejectedValue(new Error("timeout"));

        const cardId = "timeout";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "7777", mode: 6 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount: 60 },
            },
          },
        });

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });

        expect(captureException).toHaveBeenNthCalledWith(
          1,
          new Error("timeout"),
          expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
        );
        expect(captureException).toHaveBeenNthCalledWith(
          2,
          new Error("timeout"),
          expect.objectContaining({ level: "fatal" }),
        );
        expect(transaction).toBeDefined();
        expect(response.status).toBe(569);
      });

      it("fails with transaction revert", async () => {
        vi.spyOn(publicClient, "waitForTransactionReceipt").mockResolvedValue({
          ...receipt,
          status: "reverted",
          logs: [],
        });

        const cardId = "revert";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 5 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount: 70 },
            },
          },
        });

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });

        expect(captureException).toHaveBeenNthCalledWith(
          1,
          expect.any(BaseError),
          expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
        );
        expect(captureException).toHaveBeenNthCalledWith(
          2,
          expect.any(BaseError),
          expect.objectContaining({ level: "fatal" }),
        );
        expect(transaction).toBeDefined();
        expect(response.status).toBe(569);
      });

      it("fails with unexpected error", async () => {
        vi.spyOn(publicClient, "simulateContract").mockRejectedValue(new Error("Unexpected Error"));

        const cardId = "unexpected";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 4 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount: 90 },
            },
          },
        });

        expect(captureException).toHaveBeenCalledWith(
          new Error("Unexpected Error"),
          expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
        );
        expect(response.status).toBe(569);
      });

      describe("with drain proposal", () => {
        beforeAll(async () => {
          await execute(
            encodeFunctionData({
              abi: exaPluginAbi,
              functionName: "propose",
              args: [
                inject("MarketUSDC"),
                420_000_000n - 1n,
                ProposalType.Withdraw,
                encodeAbiParameters([{ type: "address" }], [owner.account.address]),
              ],
            }),
          );
        });

        it("clears debit", async () => {
          const amount = 180;
          await database.insert(cards).values([{ id: "drain-coll", credentialId: "cred", lastFour: "5678", mode: 0 }]);

          const response = await appClient.index.$post({
            ...authorization,
            json: {
              ...authorization.json,
              action: "created",
              body: {
                ...authorization.json.body,
                id: "drain-coll",
                spend: { ...authorization.json.body.spend, cardId: "drain-coll", amount },
              },
            },
          });

          expect(response.status).toBe(200);
        });
      });
    });
  });

  describe("refund and reversal", () => {
    describe("with collateral", () => {
      beforeAll(async () => {
        await keeper.exaSend(
          { name: "mint usdc", op: "tx.mint" },
          { address: inject("USDC"), abi: mockERC20Abi, functionName: "mint", args: [account, 420_000_000n] },
        );
        await keeper.exaSend(
          { name: "poke", op: "exa.poke" },
          { address: account, abi: exaPluginAbi, functionName: "poke", args: [inject("MarketUSDC")] },
        );
      });

      beforeEach(() => {
        vi.spyOn(panda, "getUser").mockResolvedValue(userResponseTemplate);
      });

      afterEach(() => vi.restoreAllMocks());

      it("handles reversal", async () => {
        const amount = 2073;
        const cardId = "card";

        const createdAt = new Date().toISOString();
        await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount, localAmount: amount, authorizedAt: createdAt },
            },
          },
        });

        const updatedAt = new Date(new Date(createdAt).getTime() + 1000 * 30).toISOString();
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "updated",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                cardId,
                authorizationUpdateAmount: -amount,
                authorizedAt: updatedAt,
                status: "reversed",
              },
            },
          },
        });

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });
        const refundReceipt = await publicClient.waitForTransactionReceipt({
          hash: transaction?.hashes[1] as Hex,
          confirmations: 0,
        });
        const deposit = refundReceipt.logs
          .filter((l) => l.address.toLowerCase() === inject("MarketUSDC").toLowerCase())
          .map((l) => decodeEventLog({ abi: marketAbi, eventName: "Deposit", topics: l.topics, data: l.data }))
          .find((l) => l.args.owner === account);

        expect(deposit?.args.assets).toBe(BigInt(amount * 1e4));
        expect(response.status).toBe(200);
        expect(setUser).toHaveBeenCalledWith({ id: account });
        expect(onesignal.sendPushNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            headings: { en: "Refund processed" },
            contents: expect.objectContaining({ en: expect.stringContaining("99999") }),
          }),
        );
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "TransactionRefund",
            properties: expect.objectContaining({ type: "reversal" }),
          }),
        );
      });

      it("fails with spending transaction not found", async () => {
        const amount = 5;
        const cardId = "card";

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "updated",
            body: {
              ...authorization.json.body,
              id: "reversal-without-pending",
              spend: {
                ...authorization.json.body.spend,
                cardId,
                authorizationUpdateAmount: -amount,
                authorizedAt: new Date().toISOString(),
                status: "reversed",
              },
            },
          },
        });

        await expect(response.json()).resolves.toStrictEqual({ code: "transaction not found" });
        expect(response.status).toBe(553);
      });

      it("handles refund", async () => {
        const amount = 2000;
        const cardId = "card";

        const createdAt = new Date().toISOString();
        await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: "refund",
              spend: { ...authorization.json.body.spend, cardId, amount, localAmount: amount, authorizedAt: createdAt },
            },
          },
        });

        const completedAt = new Date(new Date(createdAt).getTime() + 1000 * 30).toISOString();
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: "refund",
              spend: {
                ...authorization.json.body.spend,
                cardId,
                amount: -amount,
                localAmount: -amount,
                authorizedAmount: -amount,
                authorizedAt: createdAt,
                postedAt: completedAt,
                status: "completed",
              },
            },
          },
        });

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, "refund") });
        const refundReceipt = await publicClient.waitForTransactionReceipt({
          hash: transaction?.hashes[1] as Hex,
          confirmations: 0,
        });
        const deposit = refundReceipt.logs
          .filter((l) => l.address.toLowerCase() === inject("MarketUSDC").toLowerCase())
          .map((l) => decodeEventLog({ abi: marketAbi, eventName: "Deposit", topics: l.topics, data: l.data }))
          .find((l) => l.args.owner === account);

        expect(transaction?.payload).toMatchObject({
          bodies: [
            { action: "created", createdAt },
            { action: "completed", createdAt: completedAt },
          ],
        });
        expect(deposit?.args.assets).toBe(BigInt(amount * 1e4));
        expect(response.status).toBe(200);
        expect(setUser).toHaveBeenCalledWith({ id: account });
        expect(onesignal.sendPushNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            headings: { en: "Refund processed" },
            contents: expect.objectContaining({ en: expect.stringContaining("99999") }),
          }),
        );
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "TransactionRefund",
            properties: expect.objectContaining({ type: "refund" }),
          }),
        );
        expect(sardine.feedback).toHaveBeenCalledWith(
          expect.objectContaining({ feedback: { type: "settlement", status: "refund" } }),
        );
      });

      it("refunds without traceable spending", async () => {
        const amount = 3000;
        const cardId = "card";

        const createdAt = new Date().toISOString();
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: "no-spending",
              spend: {
                ...authorization.json.body.spend,
                cardId,
                amount: -amount,
                localAmount: -amount,
                authorizedAmount: -amount,
                authorizedAt: createdAt,
                postedAt: createdAt,
                status: "completed",
              },
            },
          },
        });

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, "no-spending") });
        const refundReceipt = await publicClient.waitForTransactionReceipt({
          hash: transaction?.hashes[0] as Hex,
          confirmations: 0,
        });
        const deposit = refundReceipt.logs
          .filter((l) => l.address.toLowerCase() === inject("MarketUSDC").toLowerCase())
          .map((l) => decodeEventLog({ abi: marketAbi, eventName: "Deposit", topics: l.topics, data: l.data }))
          .find((l) => l.args.owner === account);

        expect(transaction?.payload).toMatchObject({
          bodies: [{ action: "completed", createdAt }],
        });
        expect(deposit?.args.assets).toBe(BigInt(amount * 1e4));
        expect(response.status).toBe(200);
        expect(sardine.feedback).toHaveBeenCalledWith(
          expect.objectContaining({ feedback: { type: "settlement", status: "refund" } }),
        );
      });

      it("returns 569 when refund execution fails", async () => {
        const amount = 500;
        const cardId = "card";
        const createdAt = new Date().toISOString();

        await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: "refund-fail",
              spend: {
                ...authorization.json.body.spend,
                cardId,
                amount,
                localAmount: amount,
                authorizedAt: createdAt,
              },
            },
          },
        });

        vi.spyOn(publicClient, "simulateContract").mockRejectedValue(new Error("execution reverted"));

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: "refund-fail",
              spend: {
                ...authorization.json.body.spend,
                cardId,
                amount: -amount,
                localAmount: -amount,
                authorizedAmount: -amount,
                authorizedAt: createdAt,
                postedAt: new Date().toISOString(),
                status: "completed",
              },
            },
          },
        });

        expect(response.status).toBe(569);
        expect(captureException).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({ level: "fatal", tags: { unhandled: true } }),
        );
      });

      it("throws when user is not active during refund", async () => {
        vi.spyOn(panda, "getUser").mockResolvedValue({ ...userResponseTemplate, isActive: false });
        const amount = 400;
        const cardId = "card";
        const createdAt = new Date().toISOString();

        await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: "inactive-refund",
              spend: {
                ...authorization.json.body.spend,
                cardId,
                amount,
                localAmount: amount,
                authorizedAt: createdAt,
              },
            },
          },
        });

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: "inactive-refund",
              spend: {
                ...authorization.json.body.spend,
                cardId,
                amount: -amount,
                localAmount: -amount,
                authorizedAmount: -amount,
                authorizedAt: createdAt,
                postedAt: new Date().toISOString(),
                status: "completed",
              },
            },
          },
        });

        expect(response.status).toBe(500);
      });

      it("catches refund push notification error", async () => {
        const amount = 100;
        const cardId = "card";
        const createdAt = new Date().toISOString();

        await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: "refund-push",
              spend: { ...authorization.json.body.spend, cardId, amount, localAmount: amount, authorizedAt: createdAt },
            },
          },
        });

        vi.spyOn(onesignal, "sendPushNotification").mockRejectedValueOnce(new Error("push failed"));
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: "refund-push",
              spend: {
                ...authorization.json.body.spend,
                cardId,
                amount: -amount,
                localAmount: -amount,
                authorizedAmount: -amount,
                authorizedAt: createdAt,
                postedAt: new Date().toISOString(),
                status: "completed",
              },
            },
          },
        });

        expect(response.status).toBe(200);
        await vi.waitFor(() => expect(captureException).toHaveBeenCalledWith(new Error("push failed")));
      });

      it("handles non-Error in refund catch-all", async () => {
        const amount = 100;
        const cardId = "card";
        const createdAt = new Date().toISOString();

        await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: "refund-non-error",
              spend: { ...authorization.json.body.spend, cardId, amount, localAmount: amount, authorizedAt: createdAt },
            },
          },
        });

        vi.spyOn(keeper, "exaSend").mockRejectedValueOnce("refund boom");
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: "refund-non-error",
              spend: {
                ...authorization.json.body.spend,
                cardId,
                amount: -amount,
                localAmount: -amount,
                authorizedAmount: -amount,
                authorizedAt: createdAt,
                postedAt: new Date().toISOString(),
                status: "completed",
              },
            },
          },
        });

        expect(response.status).toBe(569);
        expect(captureException).toHaveBeenCalledWith("refund boom", expect.objectContaining({ level: "fatal" }));
        expect(await response.json()).toEqual({ code: "refund boom" });
      });

      it("throws when card not found during refund", async () => {
        vi.spyOn(panda, "getUser").mockResolvedValue(userResponseTemplate);
        const createdAt = new Date().toISOString();

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "updated",
            body: {
              ...authorization.json.body,
              id: "no-card-refund",
              spend: {
                ...authorization.json.body.spend,
                cardId: "nonexistent-card",
                authorizationUpdateAmount: -100,
                authorizedAt: createdAt,
                status: "reversed",
              },
            },
          },
        });

        expect(response.status).toBe(500);
      });
    });
  });

  describe("capture", () => {
    describe("with collateral", () => {
      beforeAll(async () => {
        await keeper.exaSend(
          { name: "mint usdc", op: "tx.mint" },
          { address: inject("USDC"), abi: mockERC20Abi, functionName: "mint", args: [account, 100_000_000n] },
        );
        await keeper.exaSend(
          { name: "poke", op: "exa.poke" },
          { address: account, abi: exaPluginAbi, functionName: "poke", args: [inject("MarketUSDC")] },
        );
      });

      afterEach(() => vi.restoreAllMocks());

      it("settles debit", async () => {
        const hold = 7;
        const capture = 7;

        const cardId = "settles-debit";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);
        const createResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, amount: hold, cardId, localAmount: hold },
            },
          },
        });
        const completeResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                amount: capture,
                authorizedAmount: hold,
                authorizedAt: new Date().toISOString(),
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
              },
            },
          },
        });

        expect(createResponse.status).toBe(200);
        expect(completeResponse.status).toBe(200);

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });

        expect(transaction).toMatchObject({
          hashes: [expect.any(String), zeroHash],
          payload: {
            bodies: [
              { action: "created" },
              { action: "completed", body: { spend: { amount: capture, authorizedAmount: hold } } },
            ],
          },
        });
        expect(setUser).toHaveBeenCalledWith({ id: account });
        expect(onesignal.sendPushNotification).toHaveBeenCalledTimes(1);
        expect(sardine.feedback).toHaveBeenCalledWith(
          expect.objectContaining({ feedback: { type: "settlement", status: "settled" } }),
        );
      });

      it("over-captures frozen debit", async () => {
        const hold = 12;
        const capture = 18;

        const cardId = "over-capture-frozen-debit";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);
        const createResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, amount: hold, cardId, localAmount: hold },
            },
          },
        });

        await database.update(cards).set({ status: "FROZEN" }).where(eq(cards.id, cardId));

        const completeResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                amount: capture,
                authorizedAmount: hold,
                authorizedAt: new Date().toISOString(),
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
              },
            },
          },
        });

        expect(createResponse.status).toBe(200);
        expect(completeResponse.status).toBe(200);

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });

        expect(transaction).toMatchObject({
          hashes: [expect.any(String), expect.any(String)],
          payload: {
            bodies: [{ action: "created" }, { action: "completed", body: { spend: { amount: capture } } }],
          },
        });
      });

      it("over capture debit", async () => {
        const hold = 25;
        const capture = 30;

        const cardId = "over-capture-debit";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);
        const createResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, amount: hold, cardId, localAmount: hold },
            },
          },
        });

        const completeResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                amount: capture,
                authorizedAmount: hold,
                authorizedAt: new Date().toISOString(),
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
              },
            },
          },
        });

        expect(createResponse.status).toBe(200);
        expect(completeResponse.status).toBe(200);

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });

        expect(transaction).toMatchObject({
          hashes: [expect.any(String), expect.any(String)],
          payload: {
            bodies: [{ action: "created" }, { action: "completed", body: { spend: { amount: capture } } }],
          },
        });
        expect(sardine.feedback).toHaveBeenCalledWith(
          expect.objectContaining({ feedback: { type: "settlement", status: "settled" } }),
        );
      });

      it("partial capture debit", async () => {
        const hold = 80;
        const capture = 40;
        const cardId = "partial-capture-debit";
        vi.spyOn(panda, "getUser").mockResolvedValue(userResponseTemplate);
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);
        const createResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, amount: hold, cardId, localAmount: hold },
            },
          },
        });

        const completeResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                amount: capture,
                authorizedAmount: hold,
                authorizedAt: new Date().toISOString(),
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
              },
            },
          },
        });

        expect(createResponse.status).toBe(200);
        expect(completeResponse.status).toBe(200);

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });

        expect(transaction).toMatchObject({
          hashes: [expect.any(String), expect.any(String)],
          payload: {
            bodies: [{ action: "created" }, { action: "completed", body: { spend: { amount: capture } } }],
          },
        });
        expect(segment.track).toHaveBeenCalledWith(
          expect.objectContaining({
            event: "TransactionRefund",
            properties: expect.objectContaining({ type: "partial" }),
          }),
        );
        expect(sardine.feedback).toHaveBeenCalledWith(
          expect.objectContaining({ feedback: { type: "settlement", status: "settled" } }),
        );
      });

      it("force capture debit", async () => {
        const capture = 42;

        const cardId = "force-capture-debit";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);
        const { authorizedAmount, ...spend } = authorization.json.body.spend;
        const completeResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...spend,
                amount: capture,
                authorizedAt: new Date().toISOString(),
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
              },
            },
          },
        });

        expect(completeResponse.status).toBe(200);

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });

        expect(transaction).toMatchObject({
          hashes: [expect.any(String)],
          payload: {
            bodies: [{ action: "completed", body: { spend: { amount: capture } } }],
          },
        });
        expect(setUser).toHaveBeenCalledWith({ id: account });
        expect(onesignal.sendPushNotification).toHaveBeenCalledWith(
          expect.objectContaining({ headings: { en: "Card purchase" }, contents: expect.objectContaining({ en: expect.stringContaining("with USDC") }) }),
        );
        expect(sardine.feedback).toHaveBeenCalledWith(
          expect.objectContaining({ feedback: { type: "settlement", status: "settled" } }),
        );
      });

      it("force capture fraud", async () => {
        const updateUser = vi.spyOn(panda, "updateUser").mockResolvedValue(userResponseTemplate);
        const currentFunds = await publicClient
          .readContract({
            address: inject("MarketUSDC"),
            abi: marketAbi,
            functionName: "balanceOf",
            args: [account],
          })
          .then((shares) => {
            return publicClient.readContract({
              address: inject("MarketUSDC"),
              abi: marketAbi,
              functionName: "convertToAssets",
              args: [shares],
            });
          });

        const capture = Number(currentFunds) / 1e4 + 10_000;

        const cardId = "force-capture-fraud";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);
        const { authorizedAmount, ...spend } = authorization.json.body.spend;
        const completeResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...spend,
                amount: capture,
                authorizedAt: new Date().toISOString(),
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
                userId: account,
              },
            },
          },
        });

        expect(completeResponse.status).toBe(556);
        expect(updateUser).toHaveBeenCalledWith({ id: account, isActive: false });
      });

      it("returns 569 without deactivation when completed collection fails with prior authorization", async () => {
        const updateUserSpy = vi.spyOn(panda, "updateUser").mockResolvedValue(userResponseTemplate);
        const hold = 50;
        const capture = 60;
        const cardId = "fail-with-prior-auth";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);

        await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, amount: hold, cardId, localAmount: hold },
            },
          },
        });

        vi.spyOn(publicClient, "simulateContract").mockRejectedValue(new Error("execution reverted"));

        const completeResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                amount: capture,
                authorizedAmount: hold,
                authorizedAt: new Date().toISOString(),
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
              },
            },
          },
        });

        expect(completeResponse.status).toBe(569);
        expect(updateUserSpy).not.toHaveBeenCalled();
      });

      it("handles non-Error in collection failure for created action", async () => {
        vi.spyOn(publicClient, "simulateContract").mockRejectedValueOnce("string error");
        const cardId = "non-error-coll";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, amount: 10, cardId, localAmount: 10 },
            },
          },
        });

        expect(response.status).toBe(569);
        expect(captureException).toHaveBeenCalledWith("string error", expect.anything());
      });

      it("handles non-Error in collection failure for completed action without prior auth", async () => {
        vi.spyOn(panda, "updateUser").mockResolvedValue(userResponseTemplate);
        vi.spyOn(publicClient, "simulateContract").mockRejectedValueOnce("collection boom");
        const cardId = "non-error-force";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);
        const { authorizedAmount, ...spend } = authorization.json.body.spend;

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "completed",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...spend,
                amount: 100,
                authorizedAt: new Date().toISOString(),
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
                userId: account,
              },
            },
          },
        });

        expect(response.status).toBe(556);
        expect(captureException).toHaveBeenCalledWith("collection boom", expect.anything());
      });
    });
  });
});

describe("card notification", () => {
  beforeAll(async () => {
    await database.update(credentials).set({ pandaId: "cred" }).where(eq(credentials.id, "cred"));
  });

  it("returns ok with known user", async () => {
    const response = await appClient.index.$post({
      header: { signature: "panda-signature" },
      json: {
        resource: "card",
        action: "notification",
        id: "webhook-id",
        body: {
          id: "notification-id",
          card: { id: "card", userId: "cred" },
          tokenWallet: "Apple",
          reasonCode: "PROVISIONING_DECLINED",
          decisionReason: { code: "WALLET_PROVIDER_RISK_THRESHOLD_EXCEEDED", description: "declined" },
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(setUser).toHaveBeenCalledWith({ id: account });
  });

  it("returns ok with null userId", async () => {
    const response = await appClient.index.$post({
      header: { signature: "panda-signature" },
      json: {
        resource: "card",
        action: "notification",
        id: "webhook-id",
        body: {
          id: "notification-id",
          card: { id: "card", userId: null },
          tokenWallet: "Apple",
          reasonCode: "PROVISIONING_DECLINED",
          decisionReason: { code: "WALLET_PROVIDER_RISK_THRESHOLD_EXCEEDED", description: "declined" },
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(setUser).not.toHaveBeenCalled();
  });

  it("returns ok with unknown userId", async () => {
    const response = await appClient.index.$post({
      header: { signature: "panda-signature" },
      json: {
        resource: "card",
        action: "notification",
        id: "webhook-id",
        body: {
          id: "notification-id",
          card: { id: "card", userId: "unknown" },
          tokenWallet: "Apple",
          reasonCode: "PROVISIONING_DECLINED",
          decisionReason: { code: "WALLET_PROVIDER_RISK_THRESHOLD_EXCEEDED", description: "declined" },
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(setUser).not.toHaveBeenCalled();
  });

  it("returns ok without decisionReason", async () => {
    const response = await appClient.index.$post({
      header: { signature: "panda-signature" },
      json: {
        resource: "card",
        action: "notification",
        id: "webhook-id",
        body: {
          id: "notification-id",
          card: { id: "card", userId: "cred" },
          tokenWallet: "Apple",
          reasonCode: "PROVISIONING_DECLINED",
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
  });
});

describe("card updated", () => {
  it("returns ok with known user", async () => {
    const response = await appClient.index.$post({
      header: { signature: "panda-signature" },
      json: {
        resource: "card",
        action: "updated",
        id: "webhook-id",
        body: {
          id: "card",
          expirationMonth: "12",
          expirationYear: "2030",
          last4: "1234",
          limit: { amount: 1000, frequency: "per24HourPeriod" },
          status: "active",
          type: "virtual",
          userId: "cred",
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(setUser).toHaveBeenCalledWith({ id: account });
  });

  it("returns ok with unknown user", async () => {
    const response = await appClient.index.$post({
      header: { signature: "panda-signature" },
      json: {
        resource: "card",
        action: "updated",
        id: "webhook-id",
        body: {
          id: "card",
          expirationMonth: "12",
          expirationYear: "2030",
          last4: "1234",
          limit: { amount: 1000, frequency: "per24HourPeriod" },
          status: "active",
          type: "virtual",
          userId: "unknown-user",
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(setUser).not.toHaveBeenCalled();
  });
});

describe("user updated", () => {
  it("returns ok with known user", async () => {
    const response = await appClient.index.$post({
      header: { signature: "panda-signature" },
      json: {
        resource: "user",
        action: "updated",
        id: "webhook-id",
        body: {
          id: "cred",
          applicationReason: "approved",
          applicationStatus: "approved",
          firstName: "John",
          isActive: true,
          isTermsOfServiceAccepted: true,
          lastName: "Doe",
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(setUser).toHaveBeenCalledWith({ id: account });
  });

  it("returns ok with unknown user", async () => {
    const response = await appClient.index.$post({
      header: { signature: "panda-signature" },
      json: {
        resource: "user",
        action: "updated",
        id: "webhook-id",
        body: {
          id: "unknown-user",
          applicationReason: "approved",
          applicationStatus: "approved",
          firstName: "John",
          isActive: true,
          isTermsOfServiceAccepted: true,
          lastName: "Doe",
        },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(setUser).not.toHaveBeenCalled();
  });
});

describe("concurrency", () => {
  let owner2: WalletClient<ReturnType<typeof http>, typeof chain, ReturnType<typeof privateKeyToAccount>>;
  let account2: Address;

  beforeEach(async () => {
    owner2 = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(generatePrivateKey()) });
    account2 = deriveAddress(inject("ExaAccountFactory"), { x: padHex(owner2.account.address), y: zeroHash });
    await Promise.all([
      database.transaction(async (tx) => {
        await tx
          .insert(credentials)
          .values([
            { id: account2, publicKey: new Uint8Array(), account: account2, factory: inject("ExaAccountFactory") },
          ]);
        await tx.insert(cards).values([{ id: `${account2}-card`, credentialId: account2, lastFour: "1234", mode: 0 }]);
      }),
      anvilClient.setBalance({ address: owner2.account.address, value: 10n ** 24n }),
      Promise.all([
        keeper.exaSend(
          { name: "mint", op: "tx.mint" },
          { address: inject("USDC"), abi: mockERC20Abi, functionName: "mint", args: [account2, 70_000_000n] },
        ),
        keeper.exaSend(
          { name: "create account", op: "exa.account" },
          {
            address: inject("ExaAccountFactory"),
            abi: exaAccountFactoryAbi,
            functionName: "createAccount",
            args: [0n, [{ x: hexToBigInt(owner2.account.address), y: 0n }]],
          },
        ),
      ]).then(() =>
        keeper.exaSend(
          { name: "poke", op: "exa.poke" },
          { address: account2, abi: exaPluginAbi, functionName: "poke", args: [marketUSDCAddress] },
        ),
      ),
    ]);
  });

  it("handles concurrent authorizations", async () => {
    const cardId = `${account2}-card`;
    const promises = Promise.all([
      appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          body: {
            ...authorization.json.body,
            id: cardId,
            spend: { ...authorization.json.body.spend, amount: 5000, cardId },
          },
        },
      }),
      appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          body: {
            ...authorization.json.body,
            id: `${cardId}-2`,
            spend: { ...authorization.json.body.spend, amount: 4000, cardId },
          },
        },
      }),
      appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "created",
          body: {
            ...authorization.json.body,
            id: cardId,
            spend: { ...authorization.json.body.spend, amount: 5000, cardId },
          },
        },
      }),
    ]);

    const [spend, spend2, collect] = await promises;

    expect(spend.status).toBe(200);
    expect(spend2.status).toBe(554);
    expect(collect.status).toBe(200);
  });

  it("releases mutex when authorization is declined", async () => {
    const getMutex = vi.spyOn(panda, "getMutex");
    const cardId = `${account2}-card`;
    const spendAuthorization = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        body: {
          ...authorization.json.body,
          id: cardId,
          spend: { ...authorization.json.body.spend, amount: 800, cardId },
        },
      },
    });

    const collectSpendAuthorization = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "created",
        body: {
          ...authorization.json.body,
          id: cardId,
          spend: { ...authorization.json.body.spend, amount: 800, cardId, status: "declined" },
        },
      },
    });
    const lastCall = getMutex.mock.results.at(-1);
    const mutex = lastCall?.type === "return" ? lastCall.value : undefined;

    expect(mutex).toBeDefined();
    expect(mutex?.isLocked()).toBe(false);
    expect(spendAuthorization.status).toBe(200);
    expect(collectSpendAuthorization.status).toBe(200);
    expect(segment.track).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "TransactionRejected",
        properties: expect.objectContaining({ declinedReason: undefined, updated: false }),
      }),
    );
    expect(sardine.feedback).toHaveBeenCalledWith(
      expect.objectContaining({ feedback: expect.objectContaining({ type: "authorization", status: "network_declined" }) }),
    );
  });

  describe("with fake timers", () => {
    beforeEach(() => vi.useFakeTimers());

    afterEach(() => vi.useRealTimers());

    it("mutex timeout", async () => {
      const getMutex = vi.spyOn(panda, "getMutex");
      const cardId = `${account2}-card`;
      const promises = Promise.all([
        appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, amount: 1000, cardId },
            },
          },
        }),
        appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              id: `${cardId}-2`,
              spend: { ...authorization.json.body.spend, amount: 1200, cardId },
            },
          },
        }),
        appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              id: `${cardId}-3`,
              spend: { ...authorization.json.body.spend, amount: 1300, cardId },
            },
          },
        }),
      ]);

      await vi.waitUntil(() => getMutex.mock.calls.length > 2, 26_666);
      vi.advanceTimersByTime(proposalManager.delay[anvil.id] * 1000);

      const lastCall = getMutex.mock.results.at(-1);
      const mutex = lastCall?.type === "return" ? lastCall.value : undefined;
      const statuses = await promises.then((responses) => responses.map(({ status }) => status as number));

      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 554)).toHaveLength(2);
      expect(mutex?.isLocked()).toBe(true);
    });
  });
});

const authorization = {
  header: { signature: "panda-signature" },
  json: {
    resource: "transaction",
    action: "requested",
    id: "abcdef-123456",
    body: {
      id: "31eaa81e-ffd9-4a2e-97eb-dccbc5f029d7",
      type: "spend",
      spend: {
        amount: 900,
        authorizedAmount: 900,
        cardId: "543c1771-beae-4f26-b662-44ea48b40dc6",
        cardType: "virtual",
        currency: "usd",
        localAmount: 900,
        localCurrency: "usd",
        merchantCategory: "food",
        merchantCategoryCode: "FOOD",
        merchantCity: "buenos aires",
        merchantCountry: "AR",
        merchantName: "99999",
        status: "pending",
        userEmail: "mail@mail.com",
        userFirstName: "David",
        userId: "2cf0c886-f7c0-40f3-a8cd-3c4ab3997b66",
        userLastName: "Mayer",
      },
    },
  },
} as const;

const receipt = {
  status: "success",
  blockHash: zeroHash,
  blockNumber: 0n,
  contractAddress: undefined,
  cumulativeGasUsed: 0n,
  effectiveGasPrice: 0n,
  from: zeroAddress,
  gasUsed: 0n,
  logs: [],
  logsBloom: "0x",
  to: null,
  transactionHash: "0x",
  transactionIndex: 0,
  type: "0x0",
} as const;

const callFrame = {
  type: "CALL",
  from: "",
  to: "",
  gas: "0x",
  gasUsed: "0x",
  input: "0x",
} as const;

function usdcToAddress(purchaseReceipt: TransactionReceipt, address: Address) {
  return purchaseReceipt.logs
    .filter((l) => l.address.toLowerCase() === inject("USDC").toLowerCase())
    .map((l) => decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: l.topics, data: l.data }))
    .filter((l) => l.args.to === address)
    .reduce((total, l) => total + l.args.value, 0n);
}

function usdcToCollector(purchaseReceipt: TransactionReceipt) {
  return usdcToAddress(purchaseReceipt, parse(Address, "0xDb90CDB64CfF03f254e4015C4F705C3F3C834400"));
}

function execute(calldata: Hex) {
  return owner.writeContract({
    address: account,
    functionName: "execute",
    args: [account, 0n, calldata],
    abi: [...exaPluginAbi, ...issuerCheckerAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi],
  });
}

const mockERC20Abi = [
  {
    type: "function",
    name: "mint",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

const userResponseTemplate = {
  id: "some-id",
  isActive: true,
  firstName: "John",
  lastName: "Doe",
  email: "john.doe@example.com",
  phoneCountryCode: "+1",
  phoneNumber: "1234567890",
  applicationStatus: "approved",
  applicationReason: "",
} as const;

vi.mock("@sentry/node", { spy: true });
vi.mock("../../utils/segment", { spy: true });

afterEach(async () => {
  await Promise.allSettled(
    [startSpan, sardine.feedback, onesignal.sendPushNotification]
      .flatMap((fn) => vi.mocked(fn).mock.results)
      .filter((r): r is { type: "return"; value: Promise<unknown> } => r.type === "return" && r.value instanceof Promise)
      .map((r) => r.value),
  );
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
