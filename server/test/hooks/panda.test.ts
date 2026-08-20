import "../mocks/deployments";
import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/panda";
import * as sardine from "../mocks/sardine";
import * as segment from "../mocks/segment";
import "../mocks/sentry";
import "../mocks/wallet";

import { captureException, setUser } from "@sentry/node";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { parse } from "valibot";
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeErrorResult,
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
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import ProposalType from "@exactly/common/ProposalType";
import { Address, type Hash } from "@exactly/common/validation";
import { proposalManager } from "@exactly/plugin/deploy.json";

import database, { cards, credentials, transactions } from "../../database";
import createPandaHook from "../../hooks/panda";
import t, { f } from "../../i18n";
import createOnesignal from "../../utils/onesignal";
import createPanda, * as Panda from "../../utils/panda";
import publicClient from "../../utils/publicClient";
import createSardine from "../../utils/sardine";
import createSegment from "../../utils/segment";
import traceClient from "../../utils/traceClient";
import wallet from "../../utils/wallet";
import anvilClient from "../anvilClient";

import type createHookQueue from "../../workers/hook/queue";
import type createRefund from "../../workers/refund/queue";
import type { drizzle as Drizzle } from "drizzle-orm/node-postgres";

const refund = vi.hoisted(() => ({
  close: vi.fn<ReturnType<typeof createRefund>["close"]>().mockResolvedValue(),
  enqueue: vi.fn<ReturnType<typeof createRefund>["enqueue"]>(),
}));
const hookQueue = vi.hoisted(() => ({
  close: vi.fn<ReturnType<typeof createHookQueue>["close"]>().mockResolvedValue(),
  enqueue: vi.fn<ReturnType<typeof createHookQueue>["enqueue"]>().mockResolvedValue(),
}));
const pandaConfig = { key: "panda", url: "https://panda.test" };
const panda = createPanda(pandaConfig);
const sardineConfig = { key: "sardine", url: "https://api.sardine.ai" };
const issuer = privateKeyToAccount(padHex("0x420"));
const owner = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(generatePrivateKey()) });
const pandaHook = createPandaHook({
  database,
  issuer,
  onesignal: createOnesignal("onesignal"),
  panda,
  refund,
  sardine: createSardine(sardineConfig.key, sardineConfig.url),
  segment: createSegment("segment"),
  settler: owner.account,
  webhook: hookQueue,
});
const app = pandaHook.app;

vi.mock("drizzle-orm/node-postgres", async (importOriginal) => {
  const original = await importOriginal<{ drizzle: typeof Drizzle }>();
  let instance: ReturnType<typeof original.drizzle> | undefined;
  return {
    ...original,
    drizzle: ((...args: Parameters<typeof original.drizzle>) =>
      (instance ??= original.drizzle(...args))) as typeof original.drizzle,
  };
});

let keeper: ReturnType<typeof wallet>;

const appClient = testClient(app);
const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(owner.account.address), y: zeroHash });

beforeAll(async () => {
  keeper = wallet(privateKeyToAccount(padHex("0x69")));
  await Promise.all([
    pandaHook.ready,
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
    await keeper.exaSend(
      { name: "create account", op: "exa.account" },
      {
        address: inject("ExaAccountFactory"),
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(owner.account.address), y: 0n }]],
      },
    );
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

      afterEach(() => Panda.getMutex(account)?.release());

      it("fails with InsufficientAccountLiquidity", async () => {
        const currentFunds = await publicClient.readContract({
          address: inject("MarketUSDC"),
          abi: marketAbi,
          functionName: "maxWithdraw",
          args: [account],
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
        await expect(response.json()).resolves.toStrictEqual({
          code: "InsufficientAccountLiquidity",
          rejectionCode: "INSUFFICIENT_FUNDS",
        });
        expect(captureException).not.toHaveBeenCalled();
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
        await expect(response.json()).resolves.toStrictEqual({
          code: "Replay",
          rejectionCode: "UNKNOWN",
        });
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "Replay" }),
          expect.objectContaining({ level: "error", tags: { unhandled: true } }),
        );
      });

      it("fails with card not found", async () => {
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId: "rc-missing" } },
          },
        });

        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toStrictEqual({
          code: "card not found",
          rejectionCode: "UNKNOWN",
        });
      });

      it("fails with frozen card", async () => {
        const cardId = "rc-frozen";
        const transactionId = crypto.randomUUID();
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "0001", status: "FROZEN" }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              id: transactionId,
              spend: { ...authorization.json.body.spend, cardId },
            },
          },
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toStrictEqual({
          code: "frozen card",
          rejectionCode: "NOT_PERMITTED",
        });
        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, transactionId) });
        expect(transaction).toMatchObject({
          payload: {
            type: "panda",
            bodies: [{ action: "requested", status: "declined", body: { spend: { declinedReason: "frozenCard" } } }],
          },
        });
        expect(transaction).not.toHaveProperty("payload.bodies[0].reason");
      });

      it("fails with inactive card", async () => {
        const cardId = "rc-deleted";
        await database
          .insert(cards)
          .values([{ id: cardId, credentialId: "cred", lastFour: "0002", status: "DELETED" }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId } },
          },
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toStrictEqual({
          code: "card not active",
          rejectionCode: "NOT_PERMITTED",
        });
      });

      it("fails with bad panda", async () => {
        const response = await appClient.index.$post({
          ...authorization,
          json: {} as unknown as typeof authorization.json,
        });

        expect(response.status).not.toBe(200);
        expect(captureException).toHaveBeenCalledWith(new Error("bad panda"), expect.anything());
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
      });

      it("authorizes debit when risk assessment times out", async () => {
        const error = new Error("timeout");
        error.name = "TimeoutError";
        vi.spyOn(sardine, "risk").mockRejectedValueOnce(error);
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
        await expect(response.json()).resolves.toStrictEqual({
          code: "tx reverted",
          rejectionCode: "UNKNOWN",
        });
      });

      it("fails with bad collection", async () => {
        vi.spyOn(traceClient, "traceCall").mockResolvedValueOnce({ ...callFrame });
        const cardId = "rc-bad-collection";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "0004", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId } },
          },
        });

        expect(response.status).toBe(551);
        await expect(response.json()).resolves.toStrictEqual({
          code: "bad collection",
          rejectionCode: "UNKNOWN",
        });
      });

      it("fails with mutex timeout", async () => {
        const cardId = "rc-mutex";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "0003" }]);
        const mutex = Panda.createMutex(account);
        await mutex.acquire();
        try {
          const response = await appClient.index.$post({
            ...authorization,
            json: {
              ...authorization.json,
              body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId } },
            },
          });

          expect(response.status).toBe(554);
          await expect(response.json()).resolves.toStrictEqual({
            code: "mutex timeout",
            rejectionCode: "UNKNOWN",
          });
        } finally {
          mutex.release();
        }
      });

      it("fails with unexpected outer-catch error", async () => {
        vi.spyOn(Panda, "signIssuerOp").mockRejectedValueOnce(new Error("sign failed"));
        const cardId = "rc-ouch";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "0005", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: { ...authorization.json.body, spend: { ...authorization.json.body.spend, cardId } },
          },
        });

        expect(response.status).toBe(569);
        await expect(response.json()).resolves.toStrictEqual({
          code: "ouch",
          rejectionCode: "UNKNOWN",
        });
      });

      it("alarms high risk authorization", async () => {
        vi.spyOn(sardine, "risk").mockResolvedValueOnce({
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
        vi.spyOn(sardine, "risk").mockResolvedValueOnce({
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
        vi.spyOn(sardine, "risk").mockResolvedValueOnce({
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
        await vi.waitUntil(() => hookQueue.enqueue.mock.calls.length > 0);
        expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith(
          {
            receipt: {
              blockNumber: Number(purchaseReceipt.blockNumber),
              transactionHash: purchaseReceipt.transactionHash,
            },
          },
          authorization.json.id,
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
          (transaction?.hashes ?? []).map((txHash) =>
            publicClient.waitForTransactionReceipt({ hash: txHash as Hex, confirmations: 0 }),
          ),
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
      });

      it("sends locale-aware card purchase notification", async () => {
        const sendPushNotification = sendPushNotificationMock;
        // @ts-expect-error mock implementation
        vi.spyOn(keeper, "exaSend").mockImplementation(async (...args) => {
          await args[2]?.onHash?.(zeroHash as Hash);
        });
        const localAmount = 123_456;
        const cardId = "locale-notify";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "9999", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, localAmount, localCurrency: "ars" },
            },
          },
        });

        expect(response.status).toBe(200);
        expect(sendPushNotification).toHaveBeenCalledWith({
          userId: account,
          headings: t("Card purchase"),
          contents: t("{{amount}} at {{merchantName}}. Paid in {{count}} installments", {
            count: 0,
            amount: f(localAmount / 100, "ARS"),
            merchantName: authorization.json.body.spend.merchantName,
          }),
        });
      });

      it("captures card purchase notification errors", async () => {
        const error = new Error("push failed");
        sendPushNotificationMock.mockRejectedValueOnce(error);
        // @ts-expect-error mock implementation
        vi.spyOn(keeper, "exaSend").mockImplementation(async (...args) => {
          await args[2]?.onHash?.(zeroHash as Hash);
        });
        const cardId = "locale-notify-error";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "9999", mode: 0 }]);

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

        await vi.waitUntil(
          () => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error),
          15_000,
        );

        expect(captureException).toHaveBeenCalledWith(error, { level: "error" });
        expect(response.status).toBe(200);
      });

      it("captures card purchase feedback errors", async () => {
        const error = new Error("feedback failed");
        vi.spyOn(sardine, "feedback").mockRejectedValueOnce(error);
        // @ts-expect-error mock implementation
        vi.spyOn(keeper, "exaSend").mockImplementation(async (...args) => {
          await args[2]?.onHash?.(zeroHash as Hash);
        });
        const cardId = "locale-feedback-error";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "9999", mode: 0 }]);

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

        await vi.waitUntil(
          () => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error),
          15_000,
        );

        expect(captureException).toHaveBeenCalledWith(error, { level: "error" });
        expect(response.status).toBe(200);
      });

      it("fails with transaction timeout", async () => {
        const error = new Error("timeout");
        const track = vi.spyOn(segment, "track").mockReturnValue();
        const exaSend = vi.spyOn(keeper, "exaSend").mockImplementation(async (...args) => {
          const options = args[2];
          await options?.onHash?.(zeroHash as Hash);
          throw error;
        });

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

        expect(exaSend).toHaveBeenCalledOnce();
        expect(exaSend.mock.calls[0]?.[0]).toMatchObject({
          name: "collect credit",
          op: "exa.collect",
          attributes: { account },
        });
        expect(exaSend.mock.calls[0]?.[1]).toMatchObject({
          address: account,
          functionName: "collectCredit",
          args: [expect.any(BigInt), 600_000n, expect.any(BigInt), expect.any(BigInt), expect.any(String)],
        });
        expect(track).toHaveBeenCalledWith({
          userId: account,
          event: "TransactionRejected",
          properties: {
            cardMode: 6,
            declinedReason: "collection:created:collectCredit:timeout",
            id: cardId,
            reasonName: "Error",
            source: null,
            updated: false,
            usdAmount: 0.6,
            merchant: {
              name: authorization.json.body.spend.merchantName,
              category: authorization.json.body.spend.merchantCategory,
              city: authorization.json.body.spend.merchantCity,
              country: authorization.json.body.spend.merchantCountry,
            },
          },
        });
        expect(track).toHaveBeenCalledWith({
          userId: account,
          event: "PandaCollectionFailed",
          properties: {
            action: "created",
            amount: 60,
            authorizedAmount: authorization.json.body.spend.authorizedAmount,
            cardMode: 6,
            functionName: "collectCredit",
            id: cardId,
            knownTransaction: true,
            merchant: {
              name: authorization.json.body.spend.merchantName,
              category: authorization.json.body.spend.merchantCategory,
              city: authorization.json.body.spend.merchantCity,
              country: authorization.json.body.spend.merchantCountry,
            },
            reason: "timeout",
            reasonName: "Error",
            settlement: false,
            usdAmount: 0.6,
            source: null,
            webhookId: authorization.json.id,
          },
        });
        expect(captureException).toHaveBeenCalledExactlyOnceWith(error, expect.objectContaining({ level: "fatal" }));
        expect(transaction).toBeDefined();
        expect(transaction?.hashes).toContain(zeroHash);
        expect(spendFromPayload(transaction?.payload)).toMatchObject({ amount: 60, cardId });
        expect(response.status).toBe(569);
        await expect(response.text()).resolves.toBe("timeout");
      });

      it("fails with keeper timeout in debit flow", async () => {
        const waitForTransactionReceipt = publicClient.waitForTransactionReceipt;
        const waitForReceipt = vi
          .spyOn(publicClient, "waitForTransactionReceipt")
          .mockImplementation((parameters) => waitForTransactionReceipt({ ...parameters, timeout: 110 }));
        const sendRawTransaction = vi.spyOn(publicClient, "sendRawTransaction").mockResolvedValue("0x");
        const exaSend = vi.spyOn(keeper, "exaSend");

        const cardId = "timeout-debit";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "7171", mode: 0 }]);

        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: { ...authorization.json.body.spend, cardId, amount: 61 },
            },
          },
        });

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });

        expect(exaSend).toHaveBeenCalledOnce();
        expect(exaSend.mock.calls[0]?.[1]).toMatchObject({
          address: account,
          functionName: "collectDebit",
          args: [610_000n, expect.any(BigInt), expect.any(String)],
        });
        expect(waitForReceipt).toHaveBeenCalledOnce();
        expect(sendRawTransaction).toHaveBeenCalled();
        expect(captureException).toHaveBeenCalledTimes(2);
        expect(captureException).toHaveBeenNthCalledWith(
          1,
          expect.objectContaining({ name: "WaitForTransactionReceiptTimeoutError" }),
          expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
        );
        expect(captureException).toHaveBeenNthCalledWith(
          2,
          expect.objectContaining({ name: "WaitForTransactionReceiptTimeoutError" }),
          expect.objectContaining({ level: "fatal" }),
        );
        expect(transaction).toBeDefined();
        expect(transaction?.hashes).toHaveLength(1);
        expect(spendFromPayload(transaction?.payload)).toMatchObject({ amount: 61, cardId });
        expect(response.status).toBe(569);
        await expect(response.text()).resolves.toContain("Timed out while waiting for transaction");
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
        expect(hookQueue.enqueue).not.toHaveBeenCalled();
      });

      it("returns ok on replay", async () => {
        const cardId = "replay-collect";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "9999", mode: 0 }]);

        const authorizedAt = new Date().toISOString();
        const json = {
          ...authorization.json,
          action: "created" as const,
          body: {
            ...authorization.json.body,
            id: cardId,
            spend: { ...authorization.json.body.spend, cardId, amount: 50, authorizedAt },
          },
        };

        const first = await appClient.index.$post({ ...authorization, json });
        const tx = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });
        await publicClient.waitForTransactionReceipt({ hash: tx?.hashes[0] as Hex, confirmations: 0 });
        expect(first.status).toBe(200);

        const second = await appClient.index.$post({ ...authorization, json });

        expect(second.status).toBe(200);
        expect(captureException).toHaveBeenCalledExactlyOnceWith(
          expect.any(BaseError),
          expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "Replay"] }),
        );
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
    beforeEach(() => {
      refund.enqueue.mockClear().mockResolvedValue();
    });

    it("enqueues reversals", async () => {
      const amount = 2073;
      const id = "reversal-enqueued";
      await database
        .insert(transactions)
        .values([{ id, cardId: "card", hashes: [zeroHash], payload: { bodies: [], type: "panda" } }]);
      const updatedAt = new Date().toISOString();

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "updated",
          body: {
            ...authorization.json.body,
            id,
            spend: {
              ...authorization.json.body.spend,
              cardId: "card",
              authorizationUpdateAmount: -amount,
              authorizedAt: updatedAt,
              status: "reversed",
            },
          },
        },
      });

      const timestamp =
        Math.floor(new Date(updatedAt).getTime() / 1000) -
        Number(BigInt(`0x${authorization.json.id.replaceAll(/[^0-9a-f]/g, "")}`) % 3600n);
      expect(refund.enqueue).toHaveBeenCalledExactlyOnceWith(
        {
          account,
          amount: amount * 10_000,
          signature: await Panda.signIssuerOp({ account, amount: BigInt(amount) * -10_000n, timestamp }, issuer),
          timestamp,
        },
        "abcdef-123456",
      );
      expect(response.status).toBe(200);
    });

    it("enqueues refunds", async () => {
      const amount = 2000;
      const id = "refund-enqueued";
      const createdAt = new Date().toISOString();

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "completed",
          body: {
            ...authorization.json.body,
            id,
            spend: {
              ...authorization.json.body.spend,
              cardId: "card",
              amount: -amount,
              localAmount: -amount,
              authorizedAmount: -amount,
              authorizedAt: createdAt,
              postedAt: new Date(new Date(createdAt).getTime() + 1000 * 30).toISOString(),
              status: "completed",
            },
          },
        },
      });

      const timestamp =
        Math.floor(new Date(createdAt).getTime() / 1000) -
        Number(BigInt(`0x${authorization.json.id.replaceAll(/[^0-9a-f]/g, "")}`) % 3600n);
      expect(refund.enqueue).toHaveBeenCalledExactlyOnceWith(
        {
          account,
          amount: amount * 10_000,
          signature: await Panda.signIssuerOp({ account, amount: BigInt(amount) * -10_000n, timestamp }, issuer),
          timestamp,
        },
        "abcdef-123456",
      );
      expect(response.status).toBe(200);
    });

    it("verifies panda signatures", async () => {
      const amount = 2000;
      const createdAt = new Date().toISOString();

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "completed",
          body: {
            ...authorization.json.body,
            id: "refund-signed",
            spend: {
              ...authorization.json.body.spend,
              cardId: "card",
              amount: -amount,
              localAmount: -amount,
              authorizedAmount: -amount,
              authorizedAt: createdAt,
              postedAt: new Date(new Date(createdAt).getTime() + 1000 * 30).toISOString(),
              signature: await Panda.signIssuerOp(
                { account, amount: BigInt(amount) * -10_000n, timestamp: 1_700_000_100 },
                issuer,
              ),
              status: "completed",
              timestamp: 1_700_000_100,
            },
          },
        },
      });

      expect(refund.enqueue).toHaveBeenCalledOnce();
      expect(captureException).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it("captures invalid panda signatures and enqueues anyway", async () => {
      const amount = 2000;
      const createdAt = new Date().toISOString();

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "completed",
          body: {
            ...authorization.json.body,
            id: "refund-invalid",
            spend: {
              ...authorization.json.body.spend,
              cardId: "card",
              amount: -amount,
              localAmount: -amount,
              authorizedAmount: -amount,
              authorizedAt: createdAt,
              postedAt: new Date(new Date(createdAt).getTime() + 1000 * 30).toISOString(),
              signature: await Panda.signIssuerOp(
                { account, amount: BigInt(amount) * -10_000n, timestamp: 1_700_000_099 },
                issuer,
              ),
              status: "completed",
              timestamp: 1_700_000_100,
            },
          },
        },
      });

      expect(refund.enqueue).toHaveBeenCalledOnce();
      expect(captureException).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: "invalid panda signature" }),
        { level: "error" },
      );
      expect(response.status).toBe(200);
    });

    it("captures panda signatures without timestamp and enqueues anyway", async () => {
      const amount = 2000;
      const createdAt = new Date().toISOString();

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "completed",
          body: {
            ...authorization.json.body,
            id: "refund-untimed", // cspell:ignore untimed
            spend: {
              ...authorization.json.body.spend,
              cardId: "card",
              amount: -amount,
              localAmount: -amount,
              authorizedAmount: -amount,
              authorizedAt: createdAt,
              postedAt: new Date(new Date(createdAt).getTime() + 1000 * 30).toISOString(),
              signature: "0x5678",
              status: "completed",
            },
          },
        },
      });

      expect(refund.enqueue).toHaveBeenCalledOnce();
      expect(captureException).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: "timestamp not found" }),
        { level: "error" },
      );
      expect(response.status).toBe(200);
    });

    it("captures panda signature verification errors and enqueues anyway", async () => {
      const amount = 2000;
      const createdAt = new Date().toISOString();

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "completed",
          body: {
            ...authorization.json.body,
            id: "refund-malformed",
            spend: {
              ...authorization.json.body.spend,
              cardId: "card",
              amount: -amount,
              localAmount: -amount,
              authorizedAmount: -amount,
              authorizedAt: createdAt,
              postedAt: new Date(new Date(createdAt).getTime() + 1000 * 30).toISOString(),
              signature: "0x5678",
              status: "completed",
              timestamp: 1_700_000_100,
            },
          },
        },
      });

      expect(refund.enqueue).toHaveBeenCalledOnce();
      expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.any(Error), { level: "error" });
      expect(response.status).toBe(200);
    });

    it("enqueues partial captures", async () => {
      const id = "partial-enqueued";
      const createdAt = new Date().toISOString();

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "completed",
          body: {
            ...authorization.json.body,
            id,
            spend: {
              ...authorization.json.body.spend,
              cardId: "card",
              amount: 15,
              localAmount: 15,
              authorizedAmount: 20,
              authorizedAt: createdAt,
              postedAt: new Date(new Date(createdAt).getTime() + 1000 * 30).toISOString(),
              status: "completed",
            },
          },
        },
      });

      expect(refund.enqueue).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ account, amount: 50_000 }),
        "abcdef-123456",
      );
      expect(response.status).toBe(200);
    });

    it("fails with spending transaction not found", async () => {
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
              cardId: "card",
              authorizationUpdateAmount: -5,
              authorizedAt: new Date().toISOString(),
              status: "reversed",
            },
          },
        },
      });

      await expect(response.json()).resolves.toStrictEqual({ code: "transaction not found" });
      expect(response.status).toBe(553);
      expect(refund.enqueue).not.toHaveBeenCalled();
    });

    it("fails with unknown card", async () => {
      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "completed",
          body: {
            ...authorization.json.body,
            id: "refund-unknown-card",
            spend: {
              ...authorization.json.body.spend,
              cardId: "ghost-card",
              amount: -100,
              localAmount: -100,
              authorizedAmount: -100,
              authorizedAt: new Date().toISOString(),
              postedAt: new Date().toISOString(),
              status: "completed",
            },
          },
        },
      });

      expect(response.status).toBe(500);
      expect(refund.enqueue).not.toHaveBeenCalled();
    });

    it("retries refunds that cannot be queued", async () => {
      const error = new Error("queue error");
      refund.enqueue.mockRejectedValueOnce(error);
      const exaSend = vi.spyOn(keeper, "exaSend");
      const track = vi.spyOn(segment, "track");

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "completed",
          body: {
            ...authorization.json.body,
            id: "refund-enqueue-failure",
            spend: {
              ...authorization.json.body.spend,
              cardId: "card",
              amount: -100,
              localAmount: -100,
              authorizedAmount: -100,
              authorizedAt: new Date().toISOString(),
              postedAt: new Date().toISOString(),
              status: "completed",
            },
          },
        },
      });

      expect(response.status).toBe(569);
      await expect(response.json()).resolves.toStrictEqual({ code: "queue error" });
      expect(exaSend).not.toHaveBeenCalled();
      expect(track).not.toHaveBeenCalled();
      expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
        level: "error",
        tags: { queue: "refund", job: "refund" },
        extra: { id: "abcdef-123456" },
      });
    });

    it("retries refunds that cannot be queued with non-error failures", async () => {
      refund.enqueue.mockRejectedValueOnce("queue unavailable");

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "completed",
          body: {
            ...authorization.json.body,
            id: "refund-enqueue-non-error",
            spend: {
              ...authorization.json.body.spend,
              cardId: "card",
              amount: -100,
              localAmount: -100,
              authorizedAmount: -100,
              authorizedAt: new Date().toISOString(),
              postedAt: new Date().toISOString(),
              status: "completed",
            },
          },
        },
      });

      expect(response.status).toBe(569);
      await expect(response.json()).resolves.toStrictEqual({ code: "queue unavailable" });
      expect(captureException).toHaveBeenCalledExactlyOnceWith("queue unavailable", {
        level: "error",
        tags: { queue: "refund", job: "refund" },
        extra: { id: "abcdef-123456" },
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
        });
        expect(spendFromPayload(transaction?.payload)).toBeDefined();
        expect(spendFromPayload(transaction?.payload, "completed")).toMatchObject({
          amount: capture,
          authorizedAmount: hold,
        });
      });

      it("reports settlement collection failures", async () => {
        const hold = 7;
        const capture = 12;

        const cardId = "settlement-failure";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);
        const createdAt = new Date().toISOString();
        await database.insert(transactions).values([
          {
            id: cardId,
            cardId,
            hashes: [zeroHash],
            payload: {
              bodies: [{ action: "created", createdAt }],
              type: "panda",
            },
          },
        ]);

        const track = vi.spyOn(segment, "track").mockReturnValue();
        const updateUser = vi.spyOn(panda, "updateUser").mockResolvedValue(userResponseTemplate);
        vi.spyOn(keeper, "exaSend").mockRejectedValueOnce(new Error("settlement failed"));
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
                authorizedAt: createdAt,
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
                userId: account,
              },
            },
          },
        });

        expect(completeResponse.status).toBe(569);
        expect(updateUser).not.toHaveBeenCalled();
        expect(pandaLogger).not.toHaveBeenCalledWith("suspicious-user:%j", expect.anything());
        expect(track).toHaveBeenCalledWith({
          userId: account,
          event: "TransactionRejected",
          properties: {
            cardMode: 0,
            declinedReason: "collection:completed:collectDebit:settlement failed",
            id: cardId,
            reasonName: "Error",
            source: null,
            updated: true,
            usdAmount: capture / 100,
            merchant: {
              name: authorization.json.body.spend.merchantName,
              category: authorization.json.body.spend.merchantCategory,
              city: authorization.json.body.spend.merchantCity,
              country: authorization.json.body.spend.merchantCountry,
            },
          },
        });
        expect(track).toHaveBeenCalledWith({
          userId: account,
          event: "PandaCollectionFailed",
          properties: {
            action: "completed",
            amount: capture,
            authorizedAmount: hold,
            cardMode: 0,
            functionName: "collectDebit",
            id: cardId,
            knownTransaction: true,
            merchant: {
              name: authorization.json.body.spend.merchantName,
              category: authorization.json.body.spend.merchantCategory,
              city: authorization.json.body.spend.merchantCity,
              country: authorization.json.body.spend.merchantCountry,
            },
            reason: "settlement failed",
            reasonName: "Error",
            settlement: true,
            usdAmount: capture / 100,
            source: null,
            webhookId: authorization.json.id,
          },
        });
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "settlement failed" }),
          expect.objectContaining({
            level: "fatal",
            fingerprint: ["{{ default }}", "panda.collection", "completed", "collectDebit", "unknown"],
            tags: expect.objectContaining({
              unhandled: true,
              "panda.failure": "collection",
              "panda.function": "collectDebit",
              "panda.reason": "settlement failed",
              "panda.reasonName": "Error",
              "panda.settlement": "true",
            }) as unknown,
            contexts: expect.objectContaining({
              pandaCollection: expect.objectContaining({
                action: "completed",
                cardId,
                knownTransaction: true,
                reason: "settlement failed",
                reasonName: "Error",
                transactionId: cardId,
              }) as unknown,
            }) as unknown,
          }),
        );
      });

      it("suspects over-capture collection failures", async () => {
        const hold = 100;
        const capture = 120;

        const cardId = "over-capture-fraud";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);
        const updateUser = vi.spyOn(panda, "updateUser").mockResolvedValue(userResponseTemplate);

        const createResponse = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action: "created",
            body: {
              ...authorization.json.body,
              id: cardId,
              spend: {
                ...authorization.json.body.spend,
                amount: hold,
                authorizedAmount: hold,
                cardId,
                localAmount: hold,
              },
            },
          },
        });

        vi.spyOn(keeper, "exaSend").mockRejectedValueOnce(
          new BaseError("execution reverted", {
            cause: new ContractFunctionExecutionError(
              new ContractFunctionRevertedError({
                abi: auditorAbi,
                functionName: "checkBorrow",
                data: encodeErrorResult({ abi: auditorAbi, errorName: "InsufficientAccountLiquidity" }),
              }),
              { abi: auditorAbi, functionName: "checkBorrow", args: [] },
            ),
          }),
        );
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
                userId: account,
              },
            },
          },
        });

        expect(createResponse.status).toBe(200);
        expect(completeResponse.status).toBe(556);
        expect(updateUser).toHaveBeenCalledWith({ id: account, isActive: false });
        expect(pandaLogger).toHaveBeenCalledWith("suspicious-user:%j", {
          eventId: authorization.json.id,
          transactionId: cardId,
          userId: account,
          account,
          amount: capture,
        });
      });

      it("captures collection errors when transaction lookup fails", async () => {
        const cardId = "lookup-failure";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 6 }]);

        const collectionError = new Error("collection failed");
        const lookupError = new Error("transaction lookup failed");
        const track = vi.spyOn(segment, "track").mockReturnValue();
        vi.spyOn(keeper, "exaSend").mockRejectedValueOnce(collectionError);
        vi.spyOn(database.query.transactions, "findFirst").mockRejectedValueOnce(lookupError);

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
                amount: 60,
                authorizationUpdateAmount: 60,
                authorizedAt: new Date().toISOString(),
                cardId,
                status: "pending",
              },
            },
          },
        });

        expect(response.status).toBe(569);
        expect(track).toHaveBeenCalledWith({
          userId: account,
          event: "PandaCollectionFailed",
          properties: expect.objectContaining({
            action: "updated",
            functionName: "collectCredit",
            id: cardId,
            knownTransaction: false,
            reason: "collection failed",
            reasonName: "Error",
            settlement: false,
          }) as unknown,
        });
        expect(captureException).toHaveBeenCalledWith(
          lookupError,
          expect.objectContaining({
            level: "error",
            tags: expect.objectContaining({
              unhandled: true,
              "panda.failure": "collection",
              "panda.query": "transaction",
            }) as unknown,
          }),
        );
        expect(captureException).toHaveBeenCalledWith(
          collectionError,
          expect.objectContaining({
            level: "fatal",
            tags: expect.objectContaining({
              unhandled: true,
              "panda.failure": "collection",
              "panda.reason": "collection failed",
            }) as unknown,
          }),
        );
      });

      it("does not suspend users when settlement lookup fails", async () => {
        const hold = 7;
        const capture = 12;
        const cardId = "settlement-lookup-failure";

        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);
        const createdAt = new Date().toISOString();
        await database.insert(transactions).values([
          {
            id: cardId,
            cardId,
            hashes: [zeroHash],
            payload: {
              bodies: [{ action: "created", createdAt }],
              type: "panda",
            },
          },
        ]);

        const collectionError = new Error("settlement failed");
        const lookupError = new Error("transaction lookup failed");
        const track = vi.spyOn(segment, "track").mockReturnValue();
        const updateUser = vi.spyOn(panda, "updateUser").mockResolvedValue(userResponseTemplate);
        const findFirst = database.query.transactions.findFirst.bind(database.query.transactions);
        vi.spyOn(keeper, "exaSend").mockRejectedValueOnce(collectionError);
        vi.spyOn(database.query.transactions, "findFirst")
          .mockImplementationOnce((...args) => findFirst(...args))
          .mockRejectedValueOnce(lookupError)
          .mockImplementation((...args) => findFirst(...args));

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
                amount: capture,
                authorizedAmount: hold,
                authorizedAt: createdAt,
                postedAt: new Date().toISOString(),
                cardId,
                status: "completed",
              },
            },
          },
        });

        expect(response.status).toBe(569);
        expect(updateUser).not.toHaveBeenCalled();
        expect(track).toHaveBeenCalledWith({
          userId: account,
          event: "PandaCollectionFailed",
          properties: expect.objectContaining({
            action: "completed",
            id: cardId,
            knownTransaction: false,
            reason: "settlement failed",
            reasonName: "Error",
            settlement: true,
          }) as unknown,
        });
        expect(captureException).toHaveBeenCalledWith(
          lookupError,
          expect.objectContaining({
            level: "error",
            tags: expect.objectContaining({
              unhandled: true,
              "panda.failure": "collection",
              "panda.query": "transaction",
            }) as unknown,
          }),
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
        });
        expect(spendFromPayload(transaction?.payload)).toBeDefined();
        expect(spendFromPayload(transaction?.payload, "completed")).toMatchObject({ amount: capture });
      });

      it("over-captures debit", async () => {
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
        });
        expect(spendFromPayload(transaction?.payload)).toBeDefined();
        expect(spendFromPayload(transaction?.payload, "completed")).toMatchObject({ amount: capture });
      });

      it("partial-captures debit", async () => {
        const hold = 80;
        const capture = 40;
        const cardId = "partial-capture-debit";
        vi.spyOn(panda, "getUser").mockResolvedValue(userResponseTemplate);
        await keeper.exaSend(
          { name: "mint usdc", op: "tx.mint" },
          {
            address: inject("USDC"),
            abi: mockERC20Abi,
            functionName: "mint",
            args: [inject("Refunder"), 100_000_000n],
          },
        );
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
        expect(refund.enqueue).toHaveBeenCalledWith(
          expect.objectContaining({ account, amount: (hold - capture) * 10_000 }),
          "abcdef-123456",
        );

        const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, cardId) });

        expect(transaction).toMatchObject({ hashes: [expect.any(String)] });
        expect(spendFromPayload(transaction?.payload)).toBeDefined();
      });

      it("force-captures debit", async () => {
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
        });
        expect(spendFromPayload(transaction?.payload, "completed")).toMatchObject({ amount: capture });
      });

      it("captures settlement feedback errors on over capture", async () => {
        const error = new Error("feedback failed");
        const hold = 25;
        const capture = 30;

        vi.spyOn(sardine, "feedback").mockRejectedValueOnce(error);
        const cardId = "over-capture-feedback-error";
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

        await vi.waitUntil(
          () => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error),
          15_000,
        );

        expect(captureException).toHaveBeenCalledWith(error, { level: "error" });
        expect(response.status).toBe(200);
      });

      it("force-captures fraud", async () => {
        const updateUser = vi.spyOn(panda, "updateUser").mockResolvedValue(userResponseTemplate);
        const currentFunds = await publicClient.readContract({
          address: inject("MarketUSDC"),
          abi: marketAbi,
          functionName: "maxWithdraw",
          args: [account],
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
        expect(pandaLogger).toHaveBeenCalledWith("suspicious-user:%j", {
          eventId: authorization.json.id,
          transactionId: cardId,
          userId: account,
          account,
          amount: capture,
        });
      });

      it("force-captures fraud without created body", async () => {
        const updateUser = vi.spyOn(panda, "updateUser").mockResolvedValue(userResponseTemplate);
        const capture = 80;

        const cardId = "force-capture-uncreated";
        await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "8888", mode: 0 }]);
        await database.insert(transactions).values([
          {
            id: cardId,
            cardId,
            hashes: [zeroHash],
            payload: { bodies: [{ action: "updated", createdAt: new Date().toISOString() }], type: "panda" },
          },
        ]);

        vi.spyOn(keeper, "exaSend").mockRejectedValueOnce(
          new BaseError("execution reverted", {
            cause: new ContractFunctionExecutionError(
              new ContractFunctionRevertedError({
                abi: auditorAbi,
                functionName: "checkBorrow",
                data: encodeErrorResult({ abi: auditorAbi, errorName: "InsufficientAccountLiquidity" }),
              }),
              { abi: auditorAbi, functionName: "checkBorrow", args: [] },
            ),
          }),
        );
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
        expect(pandaLogger).toHaveBeenCalledWith("suspicious-user:%j", {
          eventId: authorization.json.id,
          transactionId: cardId,
          userId: account,
          account,
          amount: capture,
        });
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

describe("dispute", () => {
  it("returns ok", async () => {
    const response = await appClient.index.$post({
      header: { signature: "panda-signature" },
      json: {
        resource: "dispute",
        action: "created",
        body: { id: "dispute-id", status: "pending", transactionId: "tx-id" },
        id: "webhook-id",
      },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
  });
});

describe("concurrency", () => {
  let owner2: WalletClient<ReturnType<typeof http>, typeof chain, ReturnType<typeof privateKeyToAccount>>;
  let account2: Address;

  beforeEach(async () => {
    owner2 = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(generatePrivateKey()) });
    account2 = deriveAddress(inject("ExaAccountFactory"), { x: padHex(owner2.account.address), y: zeroHash });
    await database.transaction(async (tx) => {
      await tx
        .insert(credentials)
        .values([
          { id: account2, publicKey: new Uint8Array(), account: account2, factory: inject("ExaAccountFactory") },
        ]);
      await tx.insert(cards).values([{ id: `${account2}-card`, credentialId: account2, lastFour: "1234", mode: 0 }]);
    });
  });

  describe("authorizations", () => {
    beforeEach(collateralize);

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
      const spendStatuses = [spend.status, spend2.status].toSorted();

      expect(spendStatuses).toStrictEqual([200, 554]);
      expect(collect.status).toBe(200);
    });

    it("releases mutex when authorization is declined", async () => {
      const getMutex = vi.spyOn(Panda, "getMutex");
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
    });
  });

  it("inserts declined transaction with zero-hash placeholder", async () => {
    const cardId = `${account2}-card`;
    const txId = "declined-tx-insert";

    const response = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "created",
        body: {
          ...authorization.json.body,
          id: txId,
          spend: {
            ...authorization.json.body.spend,
            amount: 500,
            cardId,
            status: "declined",
            declinedReason: "insufficient_funds",
          },
        },
      },
    });

    const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, txId) });

    expect(response.status).toBe(200);
    expect(transaction).toMatchObject({
      id: txId,
      cardId,
      hashes: [zeroHash],
      payload: {
        type: "panda",
        bodies: [
          {
            action: "created",
            status: "declined",
            body: { spend: { status: "declined", declinedReason: "insufficient_funds" } },
          },
        ],
      },
    });
  });

  describe("transaction history", () => {
    beforeEach(collateralize);

    it("appends body to existing transaction when declined", async () => {
      const cardId = `${account2}-card`;
      const txId = "declined-tx-update";

      await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "created",
          body: {
            ...authorization.json.body,
            id: txId,
            spend: { ...authorization.json.body.spend, amount: 600, cardId },
          },
        },
      });

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "updated",
          body: {
            ...authorization.json.body,
            id: txId,
            spend: {
              ...authorization.json.body.spend,
              amount: 600,
              authorizationUpdateAmount: 0,
              authorizedAt: new Date().toISOString(),
              cardId,
              status: "declined",
              declinedReason: "merchant_blocked",
            },
          },
        },
      });

      const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, txId) });

      expect(response.status).toBe(200);
      expect(transaction?.hashes).toHaveLength(2);
      expect(transaction?.hashes[1]).toBe(zeroHash);
      expect(transaction?.payload).toMatchObject({
        type: "panda",
        bodies: [
          { action: "created" },
          {
            action: "updated",
            status: "declined",
            body: { spend: { status: "declined", declinedReason: "merchant_blocked" } },
          },
        ],
      });
    });

    it("preserves correct body structure with interleaved pending and declined events", async () => {
      const txId = "interleaved-events-test";
      const cardId = `${account2}-card`;

      const post = (action: "created" | "updated", status: "declined" | "pending", declinedReason?: string) =>
        appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            action,
            body: {
              ...authorization.json.body,
              id: txId,
              spend: {
                ...authorization.json.body.spend,
                amount: 1000,
                cardId,
                status,
                ...(action === "updated" && { authorizationUpdateAmount: 0, authorizedAt: new Date().toISOString() }),
                ...(declinedReason && { declinedReason }),
              },
            },
          } as unknown as typeof authorization.json,
        });

      await post("created", "pending");
      await post("updated", "pending");
      await post("updated", "declined", "insufficient_funds");
      await post("updated", "declined", "merchant_blocked");

      const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, txId) });
      const bodies = (transaction?.payload as { bodies: { action: string; reason?: string; status?: string }[] })
        .bodies;

      expect(transaction?.hashes).toHaveLength(4);
      expect(bodies).toHaveLength(4);
      expect(bodies[0]).toMatchObject({ action: "created" });
      expect(bodies[1]).toMatchObject({ action: "updated" });
      expect(bodies[2]).toMatchObject({
        action: "updated",
        status: "declined",
        body: { spend: { declinedReason: "insufficient_funds" } },
      });
      expect(bodies[3]).toMatchObject({
        action: "updated",
        status: "declined",
        body: { spend: { declinedReason: "merchant_blocked" } },
      });
      expect(bodies[2]).not.toHaveProperty("reason");
      expect(bodies[3]).not.toHaveProperty("reason");
      expect(bodies[0]).not.toHaveProperty("status");
      expect(bodies[0]).not.toHaveProperty("reason");
      expect(bodies[1]).not.toHaveProperty("status");
      expect(bodies[1]).not.toHaveProperty("reason");
    });
  });

  it("declines created transaction with correct reason", async () => {
    const cardId = `${account2}-card`;
    const txId = "decline-created-test";

    const response = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "created",
        body: {
          ...authorization.json.body,
          id: txId,
          spend: {
            ...authorization.json.body.spend,
            amount: 499,
            cardId,
            status: "declined",
            declinedReason: "merchant_blocked",
          },
        },
      },
    });

    const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, txId) });

    expect(response.status).toBe(200);
    expect(transaction?.payload).toMatchObject({
      type: "panda",
      bodies: [{ action: "created", status: "declined", body: { spend: { declinedReason: "merchant_blocked" } } }],
    });
  });

  describe("with collateral", () => {
    beforeEach(collateralize);

    it("merges declined created event with prior pending created event", async () => {
      const cardId = `${account2}-card`;
      const txId = "decline-created-merge-test";

      await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "created",
          body: {
            ...authorization.json.body,
            id: txId,
            spend: { ...authorization.json.body.spend, amount: 499, cardId, status: "pending" },
          },
        },
      });

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          id: "decline-created-merge-declined-event",
          action: "created",
          body: {
            ...authorization.json.body,
            id: txId,
            spend: {
              ...authorization.json.body.spend,
              amount: 499,
              cardId,
              status: "declined",
              declinedReason: "insufficient_funds",
            },
          },
        },
      });

      const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, txId) });

      expect(response.status).toBe(200);
      expect(transaction?.payload).toMatchObject({
        type: "panda",
        bodies: [
          { action: "created" },
          { action: "created", status: "declined", body: { spend: { declinedReason: "insufficient_funds" } } },
        ],
      });
    });

    describe("with fake timers", () => {
      beforeEach(() => vi.useFakeTimers());

      afterEach(() => vi.useRealTimers());

      it("times out when mutex is locked", async () => {
        const getMutex = vi.spyOn(Panda, "getMutex");
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

  describe("push notifications", () => {
    it("sends notification when the declined transaction is created", async () => {
      const sendPushNotificationSpy = sendPushNotificationMock;
      const txId = "insufficient-liquidity-notification-test";

      const maxWithdraw = await publicClient.readContract({
        address: inject("MarketUSDC"),
        abi: marketAbi,
        functionName: "maxWithdraw",
        args: [account],
      });

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          body: {
            ...authorization.json.body,
            id: txId,
            spend: { ...authorization.json.body.spend, cardId: "card", amount: Number(maxWithdraw) / 1e4 + 100 },
          },
        },
      });

      expect(response.status).toBe(557);
      expect(sendPushNotificationSpy).not.toHaveBeenCalled();

      await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          id: "created-insufficient-liquidity-notification-test",
          action: "created",
          body: {
            ...authorization.json.body,
            id: txId,
            spend: {
              ...authorization.json.body.spend,
              cardId: "card",
              status: "declined",
              declinedReason: "webhook declined",
            },
          },
        },
      });

      await vi.waitFor(() => expect(sendPushNotificationSpy).toHaveBeenCalled());
      const call = sendPushNotificationSpy.mock.calls[0]?.[0];
      expect(call).toMatchObject({
        userId: account,
        headings: t("Exa Card purchase rejected"),
        contents: t("Transaction at {{merchantName}} for {{amount}} rejected: {{reason}}", {
          amount: f(authorization.json.body.spend.localAmount / 100, authorization.json.body.spend.localCurrency),
          merchantName: authorization.json.body.spend.merchantName,
          reason: t("insufficient funds"),
        }),
      });
    });

    it("captures declined notification errors", async () => {
      const error = new Error("push failed");
      sendPushNotificationMock.mockRejectedValueOnce(error);
      const txId = `declined-notification-error-${crypto.randomUUID()}`;

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "created",
          body: {
            ...authorization.json.body,
            id: txId,
            spend: {
              ...authorization.json.body.spend,
              cardId: `${account2}-card`,
              status: "declined",
              declinedReason: "merchant_blocked",
            },
          },
        },
      });

      await vi.waitFor(() => expect(captureException).toHaveBeenCalledWith(error, { level: "error" }));
      expect(response.status).toBe(200);
    });

    it("uses a generic reason for malformed saved payloads", async () => {
      const sendPushNotificationSpy = sendPushNotificationMock;
      const cardId = `${account2}-card`;
      const txId = `malformed-saved-payload-${crypto.randomUUID()}`;
      await database.insert(transactions).values({
        id: txId,
        cardId,
        hashes: [zeroHash],
        payload: { type: "panda", bodies: [{ action: "requested" }] },
      });

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "created",
          body: {
            ...authorization.json.body,
            id: txId,
            spend: {
              ...authorization.json.body.spend,
              cardId,
              status: "declined",
              declinedReason: "webhook declined",
            },
          },
        },
      });

      await vi.waitFor(() => expect(sendPushNotificationSpy).toHaveBeenCalled());
      expect(response.status).toBe(200);
      expect(sendPushNotificationSpy.mock.calls[0]?.[0]).toMatchObject({
        contents: t("Transaction at {{merchantName}} for {{amount}} rejected: {{reason}}", {
          amount: f(authorization.json.body.spend.localAmount / 100, authorization.json.body.spend.localCurrency),
          merchantName: authorization.json.body.spend.merchantName,
          reason: t("transaction declined"),
        }),
      });
    });

    it("uses a generic reason when the saved payload has no requested body", async () => {
      const sendPushNotificationSpy = sendPushNotificationMock;
      const cardId = `${account2}-card`;
      const txId = `missing-requested-body-${crypto.randomUUID()}`;
      await database.insert(transactions).values({
        id: txId,
        cardId,
        hashes: [zeroHash],
        payload: {
          type: "panda",
          bodies: [{ action: "created", body: { spend: { declinedReason: "merchant_blocked" } } }],
        },
      });

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "created",
          body: {
            ...authorization.json.body,
            id: txId,
            spend: {
              ...authorization.json.body.spend,
              cardId,
              status: "declined",
              declinedReason: "webhook declined",
            },
          },
        },
      });

      await vi.waitFor(() => expect(sendPushNotificationSpy).toHaveBeenCalled());
      expect(response.status).toBe(200);
      expect(sendPushNotificationSpy.mock.calls[0]?.[0]).toMatchObject({
        contents: t("Transaction at {{merchantName}} for {{amount}} rejected: {{reason}}", {
          amount: f(authorization.json.body.spend.localAmount / 100, authorization.json.body.spend.localCurrency),
          merchantName: authorization.json.body.spend.merchantName,
          reason: t("transaction declined"),
        }),
      });
    });

    it("uses the legacy requested reason when the nested reason is absent", async () => {
      const sendPushNotificationSpy = sendPushNotificationMock;
      const cardId = `${account2}-card`;
      const txId = `legacy-requested-reason-${crypto.randomUUID()}`;
      await database.insert(transactions).values({
        id: txId,
        cardId,
        hashes: [zeroHash],
        payload: {
          type: "panda",
          bodies: [
            {
              action: "requested",
              status: "declined",
              reason: "frozen card",
              body: { spend: { declinedReason: null } },
            },
          ],
        },
      });

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          action: "created",
          body: {
            ...authorization.json.body,
            id: txId,
            spend: {
              ...authorization.json.body.spend,
              cardId,
              status: "declined",
              declinedReason: "webhook declined",
            },
          },
        },
      });

      await vi.waitFor(() => expect(sendPushNotificationSpy).toHaveBeenCalled());
      expect(response.status).toBe(200);
      expect(sendPushNotificationSpy.mock.calls[0]?.[0]).toMatchObject({
        contents: t("Transaction at {{merchantName}} for {{amount}} rejected: {{reason}}", {
          amount: f(authorization.json.body.spend.localAmount / 100, authorization.json.body.spend.localCurrency),
          merchantName: authorization.json.body.spend.merchantName,
          reason: t("transaction declined"),
        }),
      });
    });

    it("recovers a local decline reason and ignores duplicate created events", async () => {
      const sendPushNotificationSpy = sendPushNotificationMock;
      const cardId = `${account2}-card`;
      const txId = "local-decline-reason-notification-test";
      const createdEvent = {
        ...authorization.json,
        id: "created-local-decline-reason-notification-test",
        action: "created" as const,
        body: {
          ...authorization.json.body,
          id: txId,
          spend: {
            ...authorization.json.body.spend,
            cardId,
            status: "declined" as const,
            declinedReason: "webhook declined",
          },
        },
      };

      await database.update(cards).set({ status: "FROZEN" }).where(eq(cards.id, cardId));
      expect(
        await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            id: "requested-local-decline-reason-notification-test",
            body: { ...authorization.json.body, id: txId, spend: { ...authorization.json.body.spend, cardId } },
          },
        }),
      ).toMatchObject({ status: 403 });
      expect(sendPushNotificationSpy).not.toHaveBeenCalled();

      expect(await appClient.index.$post({ ...authorization, json: createdEvent })).toMatchObject({ status: 200 });
      await vi.waitFor(() => expect(sendPushNotificationSpy).toHaveBeenCalledTimes(1));
      expect(sendPushNotificationSpy.mock.calls[0]?.[0]).toMatchObject({
        contents: t("Transaction at {{merchantName}} for {{amount}} rejected: {{reason}}", {
          amount: f(authorization.json.body.spend.localAmount / 100, authorization.json.body.spend.localCurrency),
          merchantName: authorization.json.body.spend.merchantName,
          reason: t("frozen card"),
        }),
      });

      await appClient.index.$post({ ...authorization, json: createdEvent });
      expect(sendPushNotificationSpy).toHaveBeenCalledTimes(1);
      expect(await database.query.transactions.findFirst({ where: eq(transactions.id, txId) })).toMatchObject({
        payload: {
          bodies: [
            { action: "requested", body: { spend: { declinedReason: "frozenCard" } } },
            { action: "created", body: { spend: { declinedReason: "webhook declined" } } },
          ],
        },
      });
    });

    it("does not notify for declined updated events", async () => {
      const sendPushNotificationSpy = sendPushNotificationMock;
      const txId = `updated-declined-${crypto.randomUUID()}`;
      const updatedEvent = {
        ...authorization.json,
        id: `${txId}-event`,
        action: "updated" as const,
        body: {
          ...authorization.json.body,
          id: txId,
          spend: {
            ...authorization.json.body.spend,
            cardId: `${account2}-card`,
            authorizationUpdateAmount: 100,
            authorizedAt: new Date().toISOString(),
            status: "declined" as const,
            declinedReason: "merchant_blocked",
          },
        },
      };

      await appClient.index.$post({ ...authorization, json: updatedEvent });
      await appClient.index.$post({ ...authorization, json: updatedEvent });

      expect(sendPushNotificationSpy).not.toHaveBeenCalled();
      expect(await database.query.transactions.findFirst({ where: eq(transactions.id, txId) })).toMatchObject({
        payload: {
          type: "panda",
          bodies: [
            { action: "updated", status: "declined", body: { spend: { declinedReason: "merchant_blocked" } } },
            { action: "updated", status: "declined", body: { spend: { declinedReason: "merchant_blocked" } } },
          ],
        },
      });
    });

    it.each([
      ["block atm (mcc 6011) transaction exceeding 250.00 usd", "atm limit reached. maximum 250 usd per transaction."],
      [
        "advertising services (mcc 7311) transaction velocity limit reached, more than 40 transactions were attempted within a 24-hour period",
        "advertising limit reached",
      ],
      [
        "atm (mcc 6011) transaction velocity limit reached, more than 3 transactions were attempted within a 24-hour period",
        "atm limit reached",
      ],
      [
        "automatic fuel dispenser velocity limit reached, more than 2 transactions were attempted within a 3-day period",
        "fuel limit reached",
      ],
      ["merchant_blocked", "this merchant is not accepted"],
      ["blocked mcc", "this merchant is not accepted"],
      ["blocked merchant", "this merchant is not accepted"],
      ["card not activated", "card not active"],
      ["card canceled", "card canceled"],
      ["card spending limit exceeded", "card limit exceeded"],
      ["frozencard", "frozen card"], // cspell:ignore frozencard
      ["account credit limit exceeded", "transaction declined"],
      ["cvv mismatch", "transaction declined"],
      ["cvv2 match fail", "transaction declined"],
      ["expiry mismatch", "transaction declined"],
      ["insufficientaccountliquidity", "insufficient funds"], // cspell:ignore insufficientaccountliquidity
      ["insufficient_funds", "insufficient funds"],
      ["invalid pin", "invalid pin"],
      ["invalid pin attempt limit exceeded", "too many invalid pin attempts"],
      ["triggers for transactions from mcc 6050 and 6051", "this merchant is not accepted"],
      ["webhook declined", "transaction declined"],
      ["unknown provider decline", "transaction declined"],
    ])("stores raw %s and notifies with %s", async (declinedReason, notificationReason) => {
      const sendPushNotificationSpy = sendPushNotificationMock;
      const txId = crypto.randomUUID();

      expect(
        await appClient.index
          .$post({
            ...authorization,
            json: {
              ...authorization.json,
              action: "created",
              body: {
                ...authorization.json.body,
                id: txId,
                spend: {
                  ...authorization.json.body.spend,
                  amount: 700,
                  cardId: `${account2}-card`,
                  status: "declined",
                  declinedReason,
                },
              },
            },
          })
          .then(({ status }) => status),
      ).toBe(200);
      const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, txId) });
      expect(transaction).toMatchObject({
        payload: {
          type: "panda",
          bodies: [{ action: "created", status: "declined", body: { spend: { declinedReason } } }],
        },
      });
      expect(transaction).not.toHaveProperty("payload.bodies[0].reason");
      await vi.waitFor(() => expect(sendPushNotificationSpy).toHaveBeenCalled());
      expect(sendPushNotificationSpy.mock.calls[0]?.[0]).toMatchObject({
        userId: account2,
        headings: t("Exa Card purchase rejected"),
        contents: t("Transaction at {{merchantName}} for {{amount}} rejected: {{reason}}", {
          amount: f(authorization.json.body.spend.localAmount / 100, authorization.json.body.spend.localCurrency),
          merchantName: authorization.json.body.spend.merchantName,
          reason: t(notificationReason),
        }),
      });
    });

    it("does not send duplicate notifications for concurrent declined transactions", async () => {
      const sendPushNotificationSpy = sendPushNotificationMock;

      const cardId = `${account2}-card`;
      const txId = `concurrent-declined-${crypto.randomUUID()}`;

      const payload = {
        ...authorization,
        json: {
          ...authorization.json,
          action: "created" as const,
          body: {
            ...authorization.json.body,
            id: txId,
            spend: {
              ...authorization.json.body.spend,
              amount: 500,
              cardId,
              status: "declined" as const,
              declinedReason: "insufficient_funds",
            },
          },
        },
      };

      await Promise.all([appClient.index.$post(payload), appClient.index.$post(payload)]);

      expect(sendPushNotificationSpy).toHaveBeenCalledTimes(1);
    });

    it("does not send notification for unknown error", async () => {
      const sendPushNotificationSpy = sendPushNotificationMock;

      vi.spyOn(traceClient, "traceCall").mockRejectedValueOnce(new Error("unexpected trace error"));

      const response = await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          body: {
            ...authorization.json.body,
            id: crypto.randomUUID(),
            spend: { ...authorization.json.body.spend, cardId: "card", amount: 100 },
          },
        },
      });

      expect(response.status).toBe(569);
      await expect(response.json()).resolves.toStrictEqual({
        code: "unexpected error",
        rejectionCode: "UNKNOWN",
      });
      expect(sendPushNotificationSpy).not.toHaveBeenCalled();
    });

    it("does not add a reason when a created decline has no raw reason", async () => {
      const txId = "created-decline-without-reason";
      await appClient.index.$post({
        ...authorization,
        json: {
          ...authorization.json,
          id: "created-decline-without-reason-event",
          action: "created",
          body: {
            ...authorization.json.body,
            id: txId,
            spend: { ...authorization.json.body.spend, cardId: `${account2}-card`, status: "declined" },
          },
        },
      });

      const transaction = await database.query.transactions.findFirst({ where: eq(transactions.id, txId) });
      expect(transaction?.payload).toMatchObject({
        bodies: [{ action: "created", body: { spend: { status: "declined" } } }],
      });
      expect(transaction).not.toHaveProperty("payload.bodies[0].body.spend.declinedReason");
    });
  });

  async function collateralize() {
    await Promise.all([
      keeper.exaSend(
        { name: "mint", op: "tx.mint" },
        {
          address: inject("USDC"),
          abi: mockERC20Abi,
          functionName: "mint",
          args: [account2, 70_000_000n],
        },
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
    ]);
    await keeper.exaSend(
      { name: "poke", op: "exa.poke" },
      {
        address: account2,
        abi: exaPluginAbi,
        functionName: "poke",
        args: [inject("MarketUSDC")],
      },
    );
  }
});

describe("webhooks", () => {
  it("enqueues declined transaction webhooks", async () => {
    const response = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "created",
        body: {
          ...authorization.json.body,
          id: crypto.randomUUID(),
          spend: {
            ...authorization.json.body.spend,
            cardId: "card",
            status: "declined",
            declinedReason: "blocked mcc",
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, authorization.json.id);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("enqueues negative amount transaction webhooks", async () => {
    const response = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "created",
        body: {
          ...authorization.json.body,
          id: crypto.randomUUID(),
          spend: { ...authorization.json.body.spend, cardId: "card", amount: -900, localAmount: -900 },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, authorization.json.id);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("enqueues card updated webhooks", async () => {
    const response = await appClient.index.$post({
      ...cardUpdated,
      json: { ...cardUpdated.json, body: { ...cardUpdated.json.body, tokenWallets: ["Apple"] } },
    });

    expect(response.status).toBe(200);
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, cardUpdated.json.id);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips card notification webhooks", async () => {
    const response = await appClient.index.$post(cardNotification);

    expect(response.status).toBe(200);
    expect(hookQueue.enqueue).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("enqueues user updated webhooks", async () => {
    const response = await appClient.index.$post(userUpdated);

    expect(response.status).toBe(200);
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, userUpdated.json.id);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips dispute webhooks", async () => {
    const response = await appClient.index.$post(dispute);

    expect(response.status).toBe(200);
    expect(hookQueue.enqueue).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("retries card updated webhooks that cannot be queued", async () => {
    const error = new Error("queue down");
    hookQueue.enqueue.mockRejectedValueOnce(error);

    const response = await appClient.index.$post({
      ...cardUpdated,
      json: { ...cardUpdated.json, body: { ...cardUpdated.json.body, tokenWallets: ["Apple"] } },
    });

    expect(response.status).toBe(569);
    await expect(response.json()).resolves.toStrictEqual({ code: "queue down" });
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, cardUpdated.json.id);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "hook", job: "hook" },
      extra: { id: cardUpdated.json.id },
    });
  });

  it("retries card updated webhooks that cannot be queued with non-error failures", async () => {
    hookQueue.enqueue.mockRejectedValueOnce("queue unavailable");

    const response = await appClient.index.$post({
      ...cardUpdated,
      json: { ...cardUpdated.json, body: { ...cardUpdated.json.body, tokenWallets: ["Apple"] } },
    });

    expect(response.status).toBe(569);
    await expect(response.json()).resolves.toStrictEqual({ code: "queue unavailable" });
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, cardUpdated.json.id);
    expect(captureException).toHaveBeenCalledExactlyOnceWith("queue unavailable", {
      level: "error",
      tags: { queue: "hook", job: "hook" },
      extra: { id: cardUpdated.json.id },
    });
  });

  it("retries declined transaction webhooks that cannot be queued", async () => {
    const error = new Error("queue down");
    hookQueue.enqueue.mockRejectedValueOnce(error);

    const response = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "created",
        body: {
          ...authorization.json.body,
          id: crypto.randomUUID(),
          spend: {
            ...authorization.json.body.spend,
            cardId: "card",
            status: "declined",
            declinedReason: "blocked mcc",
          },
        },
      },
    });

    expect(response.status).toBe(569);
    await expect(response.json()).resolves.toStrictEqual({ code: "queue down" });
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, authorization.json.id);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "hook", job: "hook" },
      extra: { id: authorization.json.id },
    });
  });

  it("retries declined transaction webhooks that cannot be queued with non-error failures", async () => {
    hookQueue.enqueue.mockRejectedValueOnce("queue unavailable");

    const response = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "created",
        body: {
          ...authorization.json.body,
          id: crypto.randomUUID(),
          spend: {
            ...authorization.json.body.spend,
            cardId: "card",
            status: "declined",
            declinedReason: "blocked mcc",
          },
        },
      },
    });

    expect(response.status).toBe(569);
    await expect(response.json()).resolves.toStrictEqual({ code: "queue unavailable" });
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, authorization.json.id);
    expect(captureException).toHaveBeenCalledExactlyOnceWith("queue unavailable", {
      level: "error",
      tags: { queue: "hook", job: "hook" },
      extra: { id: authorization.json.id },
    });
  });

  it("retries negative amount transaction webhooks that cannot be queued", async () => {
    const error = new Error("queue down");
    hookQueue.enqueue.mockRejectedValueOnce(error);

    const response = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "created",
        body: {
          ...authorization.json.body,
          id: crypto.randomUUID(),
          spend: { ...authorization.json.body.spend, cardId: "card", amount: -900, localAmount: -900 },
        },
      },
    });

    expect(response.status).toBe(569);
    await expect(response.json()).resolves.toStrictEqual({ code: "queue down" });
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, authorization.json.id);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "hook", job: "hook" },
      extra: { id: authorization.json.id },
    });
  });

  it("retries negative amount transaction webhooks that cannot be queued with non-error failures", async () => {
    hookQueue.enqueue.mockRejectedValueOnce("queue unavailable");

    const response = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "created",
        body: {
          ...authorization.json.body,
          id: crypto.randomUUID(),
          spend: { ...authorization.json.body.spend, cardId: "card", amount: -900, localAmount: -900 },
        },
      },
    });

    expect(response.status).toBe(569);
    await expect(response.json()).resolves.toStrictEqual({ code: "queue unavailable" });
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, authorization.json.id);
    expect(captureException).toHaveBeenCalledExactlyOnceWith("queue unavailable", {
      level: "error",
      tags: { queue: "hook", job: "hook" },
      extra: { id: authorization.json.id },
    });
  });

  it("retries zero collection webhooks that cannot be queued", async () => {
    const error = new Error("queue down");
    hookQueue.enqueue.mockRejectedValueOnce(error);
    const id = "zero-collection-enqueue-failure";
    await database
      .insert(transactions)
      .values([{ id, cardId: "card", hashes: [zeroHash], payload: { bodies: [], type: "panda" } }]);

    const response = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "updated",
        body: {
          ...authorization.json.body,
          id,
          spend: {
            ...authorization.json.body.spend,
            authorizationUpdateAmount: 0,
            authorizedAt: new Date().toISOString(),
            cardId: "card",
          },
        },
      },
    });

    expect(response.status).toBe(569);
    await expect(response.json()).resolves.toStrictEqual({ code: "queue down" });
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, authorization.json.id);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "hook", job: "hook" },
      extra: { id: authorization.json.id },
    });
  });

  it("retries zero collection webhooks that cannot be queued with non-error failures", async () => {
    hookQueue.enqueue.mockRejectedValueOnce("queue unavailable");
    const id = "zero-collection-enqueue-non-error";
    await database
      .insert(transactions)
      .values([{ id, cardId: "card", hashes: [zeroHash], payload: { bodies: [], type: "panda" } }]);

    const response = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "updated",
        body: {
          ...authorization.json.body,
          id,
          spend: {
            ...authorization.json.body.spend,
            authorizationUpdateAmount: 0,
            authorizedAt: new Date().toISOString(),
            cardId: "card",
          },
        },
      },
    });

    expect(response.status).toBe(569);
    await expect(response.json()).resolves.toStrictEqual({ code: "queue unavailable" });
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith({}, authorization.json.id);
    expect(captureException).toHaveBeenCalledExactlyOnceWith("queue unavailable", {
      level: "error",
      tags: { queue: "hook", job: "hook" },
      extra: { id: authorization.json.id },
    });
  });

  it("captures receipt enqueue failures", async () => {
    const error = new Error("queue down");
    hookQueue.enqueue.mockRejectedValueOnce(error);
    // @ts-expect-error mock implementation
    vi.spyOn(keeper, "exaSend").mockImplementation(async (...args) => {
      await args[2]?.onReceipt?.({
        ...receipt,
        blockNumber: 69n,
        logs: [],
        transactionHash: zeroHash,
      } as TransactionReceipt);
    });
    const cardId = "receipt-enqueue-failure";
    await database.insert(cards).values([{ id: cardId, credentialId: "cred", lastFour: "4321", mode: 0 }]);

    const response = await appClient.index.$post({
      ...authorization,
      json: {
        ...authorization.json,
        action: "created",
        body: { ...authorization.json.body, id: cardId, spend: { ...authorization.json.body.spend, cardId } },
      },
    });

    expect(response.status).toBe(200);
    expect(hookQueue.enqueue).toHaveBeenCalledExactlyOnceWith(
      { receipt: { blockNumber: 69, transactionHash: zeroHash } },
      authorization.json.id,
    );
    await vi.waitFor(() =>
      expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
        level: "error",
        tags: { queue: "hook", job: "hook" },
        extra: { id: authorization.json.id },
      }),
    );
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
        merchantId: "550e8400-e29b-41d4-a716-446655440000",
        status: "pending",
        userEmail: "mail@mail.com",
        userFirstName: "David",
        userId: "2cf0c886-f7c0-40f3-a8cd-3c4ab3997b66",
        userLastName: "Mayer",
      },
    },
  },
} as const;

const cardUpdated = {
  header: { signature: "panda-signature" },
  json: {
    id: "31740000-bd68-40c8-a400-5a0131f58800",
    resource: "card",
    action: "updated",
    body: {
      id: "f3d8a9c2-4e7b-4a1c-9f2e-8d5c6b3a7e9f",
      userId: "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      type: "virtual",
      status: "active",
      limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
      last4: "7392",
      expirationMonth: "11",
      expirationYear: "2029",
      tokenWallets: ["Apple"],
    },
  },
} as const;

const cardNotification = {
  header: { signature: "panda-signature" },
  json: {
    id: "5d3f8c21-7a4e-4b9d-8e2f-6c1a9b0d4e70",
    resource: "card",
    action: "notification",
    body: {
      id: "9b8a7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
      card: { id: "f3d8a9c2-4e7b-4a1c-9f2e-8d5c6b3a7e9f", userId: "a1b2c3d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d" },
      tokenWallet: "Apple",
      reasonCode: "PROVISIONING_DECLINED",
    },
  },
} as const;

const dispute = {
  header: { signature: "panda-signature" },
  json: {
    id: "7c2e4f8a-1b3d-4c5e-9f0a-2d4b6e8c0a1f",
    resource: "dispute",
    action: "created",
    body: { id: "dispute-1" },
  },
} as const;

const userUpdated = {
  header: { signature: "panda-signature" },
  json: {
    id: "bdc87700-bf6d-4d7d-ac29-3effb06e3000",
    resource: "user",
    action: "updated",
    body: {
      id: "0e3c467c-01e3-4fe8-8778-1c88e02fd000",
      firstName: "David",
      lastName: "Mayer",
      email: "mail@mail.com",
      isActive: true,
      isTermsOfServiceAccepted: true,
      applicationStatus: "pending",
      applicationExternalVerificationLink: {
        url: "https://cardmemberportal.com/kyc",
        params: {
          userId: "0e3c467",
          signature: "CiQAmdPUf",
        },
      },
      applicationCompletionLink: {
        url: "https://cardmemberportal.com/kyc",
        params: {
          userId: "0e3c467",
          signature: "CiQAmdPUf",
        },
      },
      applicationReason: "COMPROMISED_PERSONS, PEP",
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

function spendFromPayload(
  payload: unknown,
  action: "completed" | "created" | "updated" = "created",
): undefined | { amount?: number; authorizedAmount?: number; cardId?: string } {
  if (!payload || typeof payload !== "object" || !("bodies" in payload)) return undefined;
  const bodies = (payload as { bodies?: unknown }).bodies;
  if (!Array.isArray(bodies)) return undefined;
  for (const entry of bodies) {
    if (!entry || typeof entry !== "object" || !("action" in entry) || !("body" in entry)) continue;
    if ((entry as { action?: unknown }).action !== action) continue;
    const body = (entry as { body?: unknown }).body;
    if (!body || typeof body !== "object" || !("spend" in body)) continue;
    const spend = (body as { spend?: unknown }).spend;
    if (!spend || typeof spend !== "object") continue;
    const data = spend as { amount?: unknown; authorizedAmount?: unknown; cardId?: unknown };
    const value: { amount?: number; authorizedAmount?: number; cardId?: string } = {};
    if (typeof data.amount === "number") value.amount = data.amount;
    if (typeof data.authorizedAmount === "number") value.authorizedAmount = data.authorizedAmount;
    if (typeof data.cardId === "string") value.cardId = data.cardId;
    if ("amount" in value || "authorizedAmount" in value || "cardId" in value) return value;
  }
  return undefined;
}

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
const pandaLogger = vi.hoisted(() => vi.fn());

vi.mock("debug", () => {
  const createDebug = vi.fn((namespace: string) => {
    if (namespace === "exa:panda") return pandaLogger;
    return vi.fn();
  });
  return { default: createDebug };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
