import "../mocks/sentry";
import "../mocks/database";
import "../mocks/deployments";
import "../mocks/onesignal";
import "../mocks/panda";
import "../mocks/redis";
import "../mocks/keeper";

import ProposalType from "@exactly/common/ProposalType";
import deriveAddress from "@exactly/common/deriveAddress";
import chain, {
  auditorAbi,
  exaAccountFactoryAbi,
  exaPluginAbi,
  issuerCheckerAbi,
  marketAbi,
  marketUSDCAddress,
  upgradeableModularAccountAbi,
  usdcAddress,
} from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { proposalManager } from "@exactly/plugin/deploy.json";
import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { parse } from "valibot";
import {
  BaseError,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
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

import database, { cards, credentials, transactions } from "../../database";
import app from "../../hooks/panda";
import keeper from "../../utils/keeper";
import * as pandaUtils from "../../utils/panda";
import publicClient from "../../utils/publicClient";
import traceClient from "../../utils/traceClient";
import anvilClient from "../anvilClient";

const appClient = testClient(app);
const owner = createWalletClient({ chain, transport: http(), account: privateKeyToAccount(generatePrivateKey()) });
const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(owner.account.address), y: zeroHash });

beforeAll(async () => {
  await Promise.all([
    database.insert(credentials).values([{ id: "cred", publicKey: new Uint8Array(), account, factory: zeroAddress }]),
    database.insert(cards).values([{ id: "card", credentialId: "cred", lastFour: "1234" }]),
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
    await publicClient.waitForTransactionReceipt({
      hash: await keeper.writeContract({
        address: inject("ExaAccountFactory"),
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(owner.account.address), y: 0n }]],
      }),
      confirmations: 0,
    });
    await keeper.writeContract({
      address: inject("USDC"),
      abi: mockERC20Abi,
      functionName: "mint",
      args: [inject("Refunder"), 100_000_000n],
    });
  });

  describe("authorization", () => {
    describe("with collateral", () => {
      beforeAll(async () => {
        await keeper.writeContract({
          address: inject("USDC"),
          abi: mockERC20Abi,
          functionName: "mint",
          args: [account, 420_000_000n],
        });
        await publicClient.waitForTransactionReceipt({
          hash: await keeper.writeContract({
            address: account,
            abi: exaPluginAbi,
            functionName: "poke",
            args: [inject("MarketUSDC")],
          }),
          confirmations: 0,
        });
      });

      afterEach(() => {
        pandaUtils.getMutex(account)?.release();
      });

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
        const response = await appClient.index.$post({
          ...authorization,
          json: {
            ...authorization.json,
            body: {
              ...authorization.json.body,
              spend: { ...authorization.json.body.spend, cardId: "card", amount: -100 },
            },
          },
        });

        expect(response.status).toBe(200);
      });

      it("fails when tracing", async () => {
        const trace = vi.spyOn(traceClient, "traceCall").mockResolvedValue({ ...callFrame, output: "0x" });

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
          expect.anything(),
        );
        expect(response.status).toBe(550);
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
        });
      });
    });
  });

  describe("clearing", () => {
    describe("with collateral", () => {
      beforeAll(async () => {
        await keeper.writeContract({
          address: inject("USDC"),
          abi: mockERC20Abi,
          functionName: "mint",
          args: [account, 420_000_000n],
        });
        await publicClient.waitForTransactionReceipt({
          hash: await keeper.writeContract({
            address: account,
            abi: exaPluginAbi,
            functionName: "poke",
            args: [inject("MarketUSDC")],
          }),
          confirmations: 0,
        });
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
                  merchantCountry: "argentina",
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
          expect.objectContaining({ level: "error" }),
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
          expect.objectContaining({ level: "error" }),
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

        expect(captureException).toHaveBeenCalledWith(new Error("Unexpected Error"), expect.anything());
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
        await keeper.writeContract({
          address: inject("USDC"),
          abi: mockERC20Abi,
          functionName: "mint",
          args: [account, 420_000_000n],
        });
        await publicClient.waitForTransactionReceipt({
          hash: await keeper.writeContract({
            address: account,
            abi: exaPluginAbi,
            functionName: "poke",
            args: [inject("MarketUSDC")],
          }),
          confirmations: 0,
        });
      });

      beforeEach(() => {
        vi.spyOn(pandaUtils, "getUser").mockResolvedValue(userResponseTemplate);
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
      });
    });
  });

  describe("capture", () => {
    describe("with collateral", () => {
      beforeAll(async () => {
        await keeper.writeContract({
          address: inject("USDC"),
          abi: mockERC20Abi,
          functionName: "mint",
          args: [account, 100_000_000n],
        });
        await publicClient.waitForTransactionReceipt({
          hash: await keeper.writeContract({
            address: account,
            abi: exaPluginAbi,
            functionName: "poke",
            args: [inject("MarketUSDC")],
          }),
          confirmations: 0,
        });
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
      });

      it("partial capture debit", async () => {
        const hold = 80;
        const capture = 40;
        const cardId = "partial-capture-debit";
        vi.spyOn(pandaUtils, "getUser").mockResolvedValue(userResponseTemplate);
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
      });

      it("force capture fraud", async () => {
        const updateUser = vi.spyOn(pandaUtils, "updateUser").mockResolvedValue(userResponseTemplate);
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
    });
  });
});

describe("concurrency", () => {
  let owner2: WalletClient<ReturnType<typeof http>, typeof chain, ReturnType<typeof privateKeyToAccount>>;
  let account2: Address;

  beforeEach(async () => {
    owner2 = createWalletClient({
      chain,
      transport: http(),
      account: privateKeyToAccount(generatePrivateKey()),
    });
    account2 = deriveAddress(inject("ExaAccountFactory"), {
      x: padHex(owner2.account.address),
      y: zeroHash,
    });
    await Promise.all([
      database
        .insert(credentials)
        .values([{ id: account2, publicKey: new Uint8Array(), account: account2, factory: zeroAddress }]),
      database.insert(cards).values([{ id: `${account2}-card`, credentialId: account2, lastFour: "1234", mode: 0 }]),
      anvilClient.setBalance({ address: owner2.account.address, value: 10n ** 24n }),
      Promise.all([
        keeper.exaSend(
          { name: "mint", op: "tx.mint" },
          {
            address: usdcAddress,
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
      ])
        .then(() =>
          keeper.writeContract({
            address: account2,
            abi: exaPluginAbi,
            functionName: "poke",
            args: [marketUSDCAddress],
          }),
        )
        .then(async (hash) => {
          const { status } = await publicClient.waitForTransactionReceipt({ hash, confirmations: 0 });
          if (status !== "success") {
            const trace = await traceClient.traceTransaction(hash);
            const error = new Error(trace.output);
            captureException(error, { contexts: { tx: { trace } } });
            Object.assign(error, { trace });
            throw error;
          }
        }),
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
    const getMutex = vi.spyOn(pandaUtils, "getMutex");
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

  describe("with fake timers", () => {
    beforeEach(() => vi.useFakeTimers());

    afterEach(() => vi.useRealTimers());

    it("mutex timeout", async () => {
      const getMutex = vi.spyOn(pandaUtils, "getMutex");
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
        merchantCountry: "argentina",
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

afterEach(() => vi.resetAllMocks());
