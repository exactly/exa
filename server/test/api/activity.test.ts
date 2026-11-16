import "../expect";

import "../mocks/auth";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import assert from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, safeParse, type InferOutput } from "valibot";
import {
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  hexToBigInt,
  http,
  padHex,
  parseEventLogs,
  toHex,
  zeroHash,
  type Hash,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain, {
  auditorAbi,
  auditorAddress,
  exaAccountFactoryAbi,
  exaAccountFactoryAddress,
  marketAbi,
  marketUSDCAddress,
  upgradeableModularAccountAbi,
  usdcAddress,
} from "@exactly/common/generated/chain";

import route, { CreditActivity, DebitActivity, InstallmentsActivity, PandaActivity } from "../../api/activity";
import database, { cards, credentials, transactions } from "../../database";
import authenticate from "../../middleware/auth";
import publicClient from "../../utils/publicClient";
import anvilClient from "../anvilClient";

function httpSerialize<T>(object: T): T {
  const cloned = structuredClone(object);
  return removeUndefined(cloned) as T;
}

function removeUndefined(object: unknown): unknown {
  if (object === null || typeof object !== "object") return object;
  if (Array.isArray(object)) return object.map((value) => removeUndefined(value));

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) {
      result[key] = removeUndefined(value);
    }
  }
  return result;
}

const appClient = testClient(route({ auth: authenticate(""), database }));
const account = deriveAddress(exaAccountFactoryAddress, {
  x: padHex(privateKeyToAddress(padHex("0xb0b"))),
  y: zeroHash,
});
const markets = await anvilClient.readContract({
  address: auditorAddress,
  abi: auditorAbi,
  functionName: "allMarkets",
});

describe.concurrent("validation", () => {
  it("fails with no auth", async () => {
    const response = await appClient.index.$get();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("fails with bad credential", async () => {
    const response = await appClient.index.$get(undefined, { headers: { "test-credential-id": "bad" } });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toStrictEqual({ code: "no credential", legacy: "no credential" });
  });

  it("fails with validation error", async () => {
    const response = await appClient.index.$get(
      { query: { include: "bad-include" } },
      { headers: { "test-credential-id": "activity" } },
    );

    expect(response.status).toBe(400);
  });

  it("succeeds with valid credential", async () => {
    const response = await appClient.index.$get(
      { query: { include: "card" } },
      { headers: { "test-credential-id": "bob" } },
    );

    expect(response.status).toBe(200);
  });
});

describe.concurrent("authenticated", () => {
  describe("card", { concurrent: false }, () => {
    type CardActivity = InferOutput<
      typeof CreditActivity | typeof DebitActivity | typeof InstallmentsActivity | typeof PandaActivity
    > & { cardId: string; lastFour: string };
    let activity: CardActivity[];
    let installment: { hash: Hash; maturity: string };
    let maturity: string;

    beforeAll(async () => {
      await database.insert(cards).values([
        { id: "first-activity-card", credentialId: "bob", lastFour: "1234" },
        { id: "second-activity-card", credentialId: "bob", lastFour: "6789" },
      ]);
      const borrows = await anvilClient.getContractEvents({
        abi: marketAbi,
        eventName: "BorrowAtMaturity",
        address: [...markets],
        args: { borrower: account },
        toBlock: "latest",
        fromBlock: 0n,
        strict: true,
      });
      assert.ok(borrows[0], "expected at least one BorrowAtMaturity event");
      maturity = String(borrows[0].args.maturity);
      const logs = [
        ...borrows,
        ...(await anvilClient.getContractEvents({
          abi: marketAbi,
          eventName: "Withdraw",
          address: [...markets],
          args: { owner: account },
          toBlock: "latest",
          fromBlock: 0n,
          strict: true,
        })),
      ];
      const timestamps = await Promise.all(
        [...new Set(logs.map(({ blockNumber }) => blockNumber))].map((blockNumber) =>
          anvilClient.getBlock({ blockNumber }),
        ),
      ).then((blocks) => new Map(blocks.map(({ number, timestamp }) => [number, timestamp])));
      const txs = [
        ...[
          ...logs.reduce((m, { args, transactionHash: h, ...v }) => {
            const d = m.get(h) ?? { ...v, events: [] as (typeof logs)[number]["args"][] };
            return m.set(h, (d.events.push(args), d));
          }, new Map<Hash, { blockNumber: bigint; eventName: string; events: (typeof logs)[number]["args"][] }>()),
        ].map(([hash, { blockNumber, eventName, events }], index) => {
          const blockTimestamp = timestamps.get(blockNumber)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
          const total = events.reduce((sum, { assets }) => sum + assets, 0n);
          const createdAt = new Date(Number(blockTimestamp) * 1000).toISOString();
          const { payload, hashes } =
            index === 0
              ? {
                  hashes: [hash] as [Hash],
                  payload: {
                    operation_id: String(index),
                    type: "cryptomate",
                    data: {
                      created_at: createdAt,
                      bill_amount: Number(total) / 1e6,
                      transaction_amount: (1200 * Number(total)) / 1e6,
                      transaction_currency_code: "ARS",
                      merchant_data: { name: "Merchant", country: "ARG", city: "Buenos Aires", state: "BA" },
                    },
                  },
                }
              : {
                  hashes: index === 1 ? ([hash] as [Hash]) : ([hash, zeroHash] as [Hash, Hash]),
                  payload: {
                    type: "panda",
                    bodies: (index === 1 ? ["completed"] : ["created", "completed"]).map((action) => ({
                      action,
                      resource: "transaction",
                      createdAt,
                      body: {
                        id: String(index),
                        spend: {
                          ...spendTemplate,
                          amount: Number(total) / 1e4,
                          localAmount: (1200 * Number(total)) / 1e4,
                          ...(action === "completed" && {
                            enrichedMerchantIcon: "https://storage.googleapis.com/icon/icon.png",
                          }),
                        },
                      },
                    })),
                  },
                };
          return {
            id: String(index),
            cardId: index === 0 ? "first-activity-card" : "second-activity-card",
            lastFour: index === 0 ? "1234" : "6789",
            hashes,
            payload,
            hash,
            blockNumber,
            eventName,
            events,
            blockTimestamp,
          };
        }),
        {
          id: "transaction-declined",
          cardId: "first-activity-card",
          lastFour: "1234",
          hashes: [zeroHash],
          hash: zeroHash,
          blockNumber: 0n,
          eventName: "request declined",
          events: [],
          blockTimestamp: 0n,
          payload: {
            type: "panda",
            bodies: [
              {
                id: "aa8b527b-c508-4550-954d-f85a25335113",
                body: {
                  id: "ac89fe24-8c17-48d5-b0df-efdd80695ed4",
                  type: "spend",
                  spend: { ...spendTemplate, amount: 1500, localAmount: 1500, localCurrency: "usd" },
                },
                action: "created",
                resource: "transaction",
                createdAt: new Date(0).toISOString(),
                status: "declined" as const,
                reason: "insufficient funds" as const,
              },
              {
                id: "bb8b527b-c508-4550-954d-f85a25335114",
                body: {
                  id: "ac89fe24-8c17-48d5-b0df-efdd80695ed4",
                  type: "spend",
                  spend: { ...spendTemplate, amount: 1500, localAmount: 1500, localCurrency: "usd" },
                },
                action: "requested",
                resource: "transaction",
                createdAt: new Date(0).toISOString(),
                status: "declined" as const,
                reason: "insufficient funds" as const,
              },
            ],
          },
        },
      ];

      await database
        .insert(transactions)
        .values(txs.map(({ id, cardId, hashes, payload }) => ({ id, cardId, hashes, payload })));

      activity = txs
        .map(({ cardId, lastFour, hashes, payload, hash, blockNumber, eventName, events, blockTimestamp }) => {
          const panda = safeParse(PandaActivity, {
            ...(payload as object),
            hashes,
            borrows:
              eventName === "Withdraw"
                ? hashes.map(() => null)
                : hashes.map((currentHash) =>
                    currentHash === hash && events.length > 0 ? { timestamp: blockTimestamp, events } : null,
                  ),
          });
          if (panda.success) return { ...panda.output, cardId, lastFour };
          const eventCount = eventName === "Withdraw" ? 0 : events.length;
          const cryptomate = safeParse({ 0: DebitActivity, 1: CreditActivity }[eventCount] ?? InstallmentsActivity, {
            ...(payload as object),
            hash,
            events: eventCount > 0 ? events : undefined,
            blockTimestamp: eventCount > 0 ? blockTimestamp : undefined,
          });
          if (cryptomate.success) return { ...cryptomate.output, cardId, lastFour };
          throw new Error("bad test setup");
        })
        .toSorted(
          (a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id, undefined, { numeric: true }),
        );
      const operation = activity
        .flatMap((item) => ("operations" in item ? item.operations : []))
        .find((item) => "borrow" in item && "installments" in item.borrow);
      assert.ok(operation && "borrow" in operation && "installments" in operation.borrow, "expected installments");
      const second = operation.borrow.installments[1];
      assert.ok(second, "expected second installment");
      installment = { hash: operation.transactionHash, maturity: String(second.maturity) };
    }, 66_666);

    it("returns the card transaction", async () => {
      const receipt = vi.spyOn(publicClient, "getTransactionReceipt");
      const response = await appClient.index.$get(
        { query: { include: "card" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject(httpSerialize(activity));
      expect(receipt).not.toHaveBeenCalled();
    });

    it("returns declined transaction in http response", async () => {
      const txId = "ac89fe24-8c17-48d5-b0df-efdd80695ed4";
      expect.hasAssertions();
      const response = await appClient.index.$get(
        { query: { include: "card" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as { id: string }[];
      const declined = json.find(({ id }) => id === txId);
      assert.ok(declined, "expected declined transaction in response");
      expect(declined).toStrictEqual(httpSerialize(activity.find(({ id }) => id === txId)));
    });

    it("keeps the landed retry of a debit", async () => {
      const [landed] = await anvilClient.getContractEvents({
        abi: marketAbi,
        eventName: "Withdraw",
        address: marketUSDCAddress,
        args: { caller: account, owner: account },
        toBlock: "latest",
        fromBlock: 0n,
        strict: true,
      });
      assert.ok(landed, "expected a usdc withdraw");
      const bodies = [retried(0), retried(1)];
      await database.insert(transactions).values([
        {
          id: "retried",
          cardId: "first-activity-card",
          hashes: [padHex("0x1", { size: 32 }), landed.transactionHash],
          payload: { type: "panda", bodies },
        },
      ]);
      try {
        const response = await appClient.index.$get(
          { query: { include: "card" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(response.status).toBe(200);
        const json = (await response.json()) as { id: string }[];
        expect(json.find(({ id }) => id === "retried")).toStrictEqual(
          httpSerialize({
            ...parse(PandaActivity, {
              type: "panda",
              hashes: [landed.transactionHash],
              borrows: [null],
              bodies: [bodies[1]],
            }),
            cardId: "first-activity-card",
            lastFour: "1234",
          }),
        );
      } finally {
        await database.delete(transactions).where(eq(transactions.id, "retried"));
      }
    });

    it("keeps the first attempt when the retry reverted", async () => {
      const sender = privateKeyToAccount(generatePrivateKey());
      await anvilClient.setBalance({ address: sender.address, value: 10n ** 18n });
      const reverted = await anvilClient.waitForTransactionReceipt({
        hash: await anvilClient.sendTransaction({
          account: sender,
          to: usdcAddress,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account, 1n] }),
          gas: 100_000n,
        }),
      });
      expect(reverted.status).toBe("reverted");
      const hashes = [padHex("0x1", { size: 32 }), reverted.transactionHash];
      const bodies = [retried(0), retried(1)];
      await database
        .insert(transactions)
        .values([{ id: "reverted", cardId: "first-activity-card", hashes, payload: { type: "panda", bodies } }]);
      try {
        const response = await appClient.index.$get(
          { query: { include: "card" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(response.status).toBe(200);
        const json = (await response.json()) as { id: string }[];
        expect(json.find(({ id }) => id === "retried")).toStrictEqual(
          httpSerialize({
            ...parse(PandaActivity, { type: "panda", hashes: [hashes[0]], borrows: [null], bodies: [bodies[0]] }),
            cardId: "first-activity-card",
            lastFour: "1234",
          }),
        );
      } finally {
        await database.delete(transactions).where(eq(transactions.id, "reverted"));
      }
    });

    it("counts two settled attempts of one event once", async () => {
      const sender = privateKeyToAccount(generatePrivateKey());
      await anvilClient.setBalance({ address: sender.address, value: 10n ** 18n });
      const hashes = await Promise.all(
        [0, 1].map(async (nonce) =>
          anvilClient
            .waitForTransactionReceipt({
              hash: await anvilClient.sendTransaction({ account: sender, to: account, value: 1n, nonce }),
            })
            .then(({ status, transactionHash }) => {
              expect(status).toBe("success");
              return transactionHash;
            }),
        ),
      );
      const bodies = [retried(0), retried(1)];
      await database
        .insert(transactions)
        .values([{ id: "settled-twice", cardId: "first-activity-card", hashes, payload: { type: "panda", bodies } }]);
      try {
        const response = await appClient.index.$get(
          { query: { include: "card" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(response.status).toBe(200);
        const json = (await response.json()) as { id: string; operations: unknown[]; usdAmount: number }[];
        const item = json.find(({ id }) => id === "retried");
        expect(item).toStrictEqual(
          httpSerialize({
            ...parse(PandaActivity, { type: "panda", hashes, borrows: [null, null], mined: [true, true], bodies }),
            cardId: "first-activity-card",
            lastFour: "1234",
          }),
        );
        expect(item?.operations).toHaveLength(2);
        expect(item?.usdAmount).toBeCloseTo(232.53);
      } finally {
        await database.delete(transactions).where(eq(transactions.id, "settled-twice"));
      }
    });

    it("reads a repeated retry hash once", async () => {
      const receipt = vi.spyOn(publicClient, "getTransactionReceipt");
      const hashes = [padHex("0x51", { size: 32 }), padHex("0x51", { size: 32 })];
      await database.insert(transactions).values([
        {
          id: "repeated",
          cardId: "first-activity-card",
          hashes,
          payload: { type: "panda", bodies: [retried(0), retried(1)] },
        },
      ]);
      try {
        const response = await appClient.index.$get(
          { query: { include: "card" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(response.status).toBe(200);
        expect(receipt.mock.calls.filter(([{ hash }]) => hashes.includes(hash))).toStrictEqual([[{ hash: hashes[0] }]]);
        const json = (await response.json()) as { id: string; operations: unknown[]; usdAmount: number }[];
        const item = json.find(({ id }) => id === "retried");
        expect(item?.operations).toHaveLength(1);
        expect(item?.usdAmount).toBeCloseTo(232.53);
      } finally {
        await database.delete(transactions).where(eq(transactions.id, "repeated"));
      }
    });

    it("bounds receipt reads of a large retry set", async () => {
      const hashes = Array.from({ length: 30 }, (_, index) => padHex(toHex(0x10_00 + index), { size: 32 }));
      const read = publicClient.getTransactionReceipt.bind(publicClient);
      let reading = 0;
      let peak = 0;
      const receipt = vi.spyOn(publicClient, "getTransactionReceipt").mockImplementation(async (parameters) => {
        if (!hashes.includes(parameters.hash)) return read(parameters);
        peak = Math.max(peak, ++reading);
        await new Promise((resolve) => setTimeout(resolve, 5));
        reading--;
        return read(parameters);
      });
      await database.insert(transactions).values([
        {
          id: "many",
          cardId: "first-activity-card",
          hashes,
          payload: { type: "panda", bodies: hashes.map((_, index) => retried(index)) },
        },
      ]);
      try {
        const response = await appClient.index.$get(
          { query: { include: "card" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(response.status).toBe(200);
        expect(receipt.mock.calls.filter(([{ hash }]) => hashes.includes(hash))).toHaveLength(hashes.length);
        expect(peak).toBe(8);
        const json = (await response.json()) as { id: string; operations: unknown[]; usdAmount: number }[];
        const item = json.find(({ id }) => id === "retried");
        expect(item?.operations).toHaveLength(1);
        expect(item?.usdAmount).toBeCloseTo(232.53);
      } finally {
        await database.delete(transactions).where(eq(transactions.id, "many"));
      }
    });

    it("stops receipt reads after a failure", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const hashes = Array.from({ length: 30 }, (_, index) => padHex(toHex(0x20_00 + index), { size: 32 }));
      const read = publicClient.getTransactionReceipt.bind(publicClient);
      const receipt = vi.spyOn(publicClient, "getTransactionReceipt").mockImplementation(async (parameters) => {
        if (!hashes.includes(parameters.hash)) return read(parameters);
        await new Promise((resolve) => setTimeout(resolve, 5));
        throw new Error("receipt");
      });
      await database.insert(transactions).values([
        {
          id: "failing",
          cardId: "first-activity-card",
          hashes,
          payload: { type: "panda", bodies: hashes.map((_, index) => retried(index)) },
        },
      ]);
      try {
        const response = await appClient.index.$get(
          { query: { include: "card" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(response.status).toBe(500);
        expect(error).toHaveBeenCalledExactlyOnceWith(new Error("receipt"));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(receipt.mock.calls.filter(([{ hash }]) => hashes.includes(hash))).toHaveLength(8);
      } finally {
        await database.delete(transactions).where(eq(transactions.id, "failing"));
      }
    });

    it("skips receipts on statements", async () => {
      const receipt = vi.spyOn(publicClient, "getTransactionReceipt");
      await database.insert(transactions).values([
        {
          id: "statement-retry",
          cardId: "second-activity-card",
          hashes: [padHex("0x61", { size: 32 }), installment.hash],
          payload: { type: "panda", bodies: [retried(0), retried(1)] },
        },
      ]);
      try {
        const response = await appClient.index.$get(
          { query: { include: "card", maturity: installment.maturity } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(response.status).toBe(200);
        expect(receipt).not.toHaveBeenCalled();
        const json = (await response.json()) as CardActivity[];
        const item = json.find(({ id }) => id === "retried");
        assert.ok(item && "operations" in item, "expected retried purchase");
        expect(item.operations.map(({ transactionHash }) => transactionHash)).toStrictEqual([installment.hash]);
        expect(item.operations[0]).toMatchObject({
          borrow: { installments: [{ current: 2, maturity: Number(installment.maturity) }] },
        });
      } finally {
        await database.delete(transactions).where(eq(transactions.id, "statement-retry"));
      }
    });

    it("skips receipts for retried declines", async () => {
      const receipt = vi.spyOn(publicClient, "getTransactionReceipt");
      const bodies = [retried(0), retried(1)].map((body) => ({ ...body, status: "declined" }));
      await database.insert(transactions).values([
        {
          id: "declined",
          cardId: "first-activity-card",
          hashes: [zeroHash, zeroHash],
          payload: { type: "panda", bodies },
        },
      ]);
      try {
        const response = await appClient.index.$get(
          { query: { include: "card" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(response.status).toBe(200);
        expect(receipt).not.toHaveBeenCalled();
      } finally {
        await database.delete(transactions).where(eq(transactions.id, "declined"));
      }
    });

    it("fails when a retry receipt cannot be read", async () => {
      const owner = { credentialId: "unreadable-credential", cardId: "unreadable-card" };
      const hashes = [padHex("0x1", { size: 32 }), padHex("0x2", { size: 32 })];
      const read = publicClient.getTransactionReceipt.bind(publicClient);
      const receipt = vi
        .spyOn(publicClient, "getTransactionReceipt")
        .mockImplementation((parameters) =>
          hashes.includes(parameters.hash) ? Promise.reject(new Error("receipt")) : read(parameters),
        );
      await database.insert(credentials).values({
        id: owner.credentialId,
        publicKey: new Uint8Array(),
        account: padHex("0xdead", { size: 20 }),
        factory: exaAccountFactoryAddress,
      });
      await database.insert(cards).values([{ id: owner.cardId, credentialId: owner.credentialId, lastFour: "0000" }]);
      await database.insert(transactions).values([
        {
          id: "unreadable",
          cardId: owner.cardId,
          hashes,
          payload: { type: "panda", bodies: [retried(0), retried(1)] },
        },
      ]);
      try {
        const response = await appClient.index.$get(
          { query: { include: "card" } },
          { headers: { "test-credential-id": owner.credentialId } },
        );

        expect(response.status).toBe(500);
        expect(receipt.mock.calls).toStrictEqual(hashes.map((hash) => [{ hash }]));
      } finally {
        await database.delete(transactions).where(eq(transactions.id, "unreadable"));
        await database.delete(cards).where(eq(cards.id, owner.cardId));
        await database.delete(credentials).where(eq(credentials.id, owner.credentialId));
      }
    });

    it("accepts panda activity with zero exchange rate", () => {
      const panda = safeParse(PandaActivity, {
        type: "panda",
        hashes: [zeroHash],
        borrows: [null],
        bodies: [
          {
            action: "created",
            resource: "transaction",
            createdAt: new Date(0).toISOString(),
            body: { id: "zero-rate", type: "spend", spend: { ...spendTemplate, amount: 100, localAmount: 0 } },
          },
        ],
      });

      expect(panda.success).toBe(true);
      if (!panda.success) return;
      expect(panda.output.amount).toBe(0);
      expect(panda.output.usdAmount).toBe(1);
      expect(panda.output.status).toBe("pending");
    });

    describe("retried collects", () => {
      const hashes = [padHex("0x1", { size: 32 }), padHex("0x2", { size: 32 }), padHex("0x3", { size: 32 })];
      const borrow = { timestamp: 1n, events: [{ maturity: 2_419_200n, assets: 232_530_000n, fee: 1_160_000n }] };

      it("counts a pending retry once", () => {
        const panda = parse(PandaActivity, {
          type: "panda",
          hashes,
          borrows: [null, null, null],
          bodies: [retried(0), retried(1), retried(2)],
        });

        expect(panda).toStrictEqual(
          parse(PandaActivity, { type: "panda", hashes: [hashes[0]], borrows: [null], bodies: [retried(0)] }),
        );
        expect(panda.usdAmount).toBeCloseTo(232.53);
        expect(panda.status).toBe("pending");
      });

      it("keeps the mined retry", () => {
        const panda = parse(PandaActivity, {
          type: "panda",
          hashes: hashes.slice(0, 2),
          borrows: [null, borrow],
          bodies: [retried(0), retried(1)],
        });

        expect(panda).toStrictEqual(
          parse(PandaActivity, { type: "panda", hashes: [hashes[1]], borrows: [borrow], bodies: [retried(1)] }),
        );
        expect(panda.operations[0]).toMatchObject({ transactionHash: hashes[1], borrow: { maturity: 2_419_200 } });
        expect(panda.usdAmount).toBeCloseTo(232.53);
      });

      it("keeps the first attempt when it was mined", () => {
        const panda = parse(PandaActivity, {
          type: "panda",
          hashes: hashes.slice(0, 2),
          borrows: [borrow, null],
          bodies: [retried(0), retried(1)],
        });

        expect(panda).toStrictEqual(
          parse(PandaActivity, { type: "panda", hashes: [hashes[0]], borrows: [borrow], bodies: [retried(0)] }),
        );
        expect(panda.operations[0]).toMatchObject({ transactionHash: hashes[0], borrow: { maturity: 2_419_200 } });
      });

      it("keeps the mined debit retry", () => {
        const panda = parse(PandaActivity, {
          type: "panda",
          hashes: hashes.slice(0, 2),
          borrows: [null, null],
          mined: [false, true],
          bodies: [retried(0), retried(1)],
        });

        expect(panda).toStrictEqual(
          parse(PandaActivity, { type: "panda", hashes: [hashes[1]], borrows: [null], bodies: [retried(1)] }),
        );
        expect(panda.operations[0]).toMatchObject({ transactionHash: hashes[1], mode: 0 });
      });

      it("keeps every settled retry", () => {
        const panda = parse(PandaActivity, {
          type: "panda",
          hashes,
          borrows: [null, null, null],
          mined: [true, false, true],
          bodies: [retried(0), retried(1), retried(2)],
        });

        expect(panda).toStrictEqual(
          parse(PandaActivity, {
            type: "panda",
            hashes: [hashes[0], hashes[2]],
            borrows: [null, null],
            mined: [true, true],
            bodies: [retried(0), retried(2)],
          }),
        );
        expect(panda.operations.map(({ transactionHash }) => transactionHash)).toStrictEqual([hashes[0], hashes[2]]);
        expect(panda.usdAmount).toBeCloseTo(232.53);
        expect(panda.amount).toBeCloseTo(232.53);
      });

      it("counts each event once with adjustments and refunds", () => {
        const event = (id: string, action: string, spend: Record<string, number>) => ({
          ...retried(0),
          id,
          action,
          body: { ...retried(0).body, spend: { ...retried(0).body.spend, ...spend } },
        });
        const panda = parse(PandaActivity, {
          type: "panda",
          hashes: [...hashes, padHex("0x4", { size: 32 })],
          borrows: [null, null, null, null],
          mined: [true, true, true, true],
          bodies: [
            retried(0),
            retried(1),
            event("updated-event", "updated", { amount: 24_253, localAmount: 24_253, authorizationUpdateAmount: 1000 }),
            event("completed-event", "completed", { amount: 20_000, localAmount: 20_000, authorizedAmount: 24_253 }),
          ],
        });

        expect(panda.operations.map(({ transactionHash }) => transactionHash)).toStrictEqual([
          ...hashes,
          padHex("0x4", { size: 32 }),
        ]);
        expect(panda.usdAmount).toBeCloseTo(200);
        expect(panda.status).toBe("settled");
      });

      it("counts a repeated settled hash once", () => {
        const panda = parse(PandaActivity, {
          type: "panda",
          hashes: [hashes[0], hashes[0]],
          borrows: [borrow, borrow],
          bodies: [retried(0), retried(1)],
        });

        expect(panda).toStrictEqual(
          parse(PandaActivity, { type: "panda", hashes: [hashes[0]], borrows: [borrow], bodies: [retried(0)] }),
        );
        expect(panda.usdAmount).toBeCloseTo(232.53);
      });

      it("keeps attempts without event ids", () => {
        const bodies = [retried(0), retried(1)].map(({ id: _, ...body }) => body);
        const panda = parse(PandaActivity, {
          type: "panda",
          hashes: hashes.slice(0, 2),
          borrows: [null, null],
          bodies,
        });

        expect(panda.operations.map(({ transactionHash }) => transactionHash)).toStrictEqual(hashes.slice(0, 2));
        expect(panda.usdAmount).toBeCloseTo(465.06);
      });
    });

    it("reports bad transaction", async () => {
      await database
        .insert(transactions)
        .values([{ id: "bad-transaction", cardId: "first-activity-card", hashes: ["0x1"], payload: {} }]);
      const response = await appClient.index.$get(
        { query: { include: "card" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(captureException).toHaveBeenCalledExactlyOnceWith(
        new Error("bad transaction"),
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          contexts: expect.objectContaining({
            cryptomate: expect.objectContaining({ success: false }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            panda: expect.objectContaining({ success: false }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          }),
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject(httpSerialize(activity));
    });

    it("filters by maturity", async () => {
      expect.hasAssertions();
      const response = await appClient.index.$get(
        { query: { maturity } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(response.status).toBe(200);

      const json = (await response.json()) as { borrow?: { maturity: number } }[];
      expect(json.every((item) => !item.borrow || item.borrow.maturity === Number(maturity))).toBe(true);
    });

    it("returns installment position when filtering by maturity", async () => {
      const response = await appClient.index.$get(
        { query: { include: "card", maturity: installment.maturity } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(response.status).toBe(200);
      const json = (await response.json()) as CardActivity[];
      expect(json.map(({ cardId, lastFour }) => ({ cardId, lastFour }))).toStrictEqual([
        { cardId: "second-activity-card", lastFour: "6789" },
        { cardId: "second-activity-card", lastFour: "6789" },
      ]);
      const installments = json.flatMap((item) =>
        "operations" in item
          ? item.operations.flatMap((operation) =>
              "borrow" in operation && "installments" in operation.borrow ? operation.borrow.installments : [],
            )
          : [],
      );
      expect(installments).toStrictEqual([
        {
          amount: expect.any(Number) as unknown,
          current: 2,
          fee: expect.any(Number) as unknown,
          maturity: Number(installment.maturity),
          rate: expect.any(Number) as unknown,
        },
      ]);
    });

    it("returns cryptomate installment position when filtering by maturity", async () => {
      try {
        await database.insert(transactions).values([
          {
            id: "cryptomate-installments",
            cardId: "first-activity-card",
            hashes: [installment.hash],
            payload: {
              operation_id: "cryptomate-installments",
              type: "cryptomate",
              data: {
                created_at: new Date(0).toISOString(),
                bill_amount: 0.46,
                transaction_amount: 552,
                transaction_currency_code: "ARS",
                merchant_data: { name: "Merchant", country: "ARG", city: "Buenos Aires", state: "BA" },
              },
            },
          },
        ]);
        const response = await appClient.index.$get(
          { query: { include: "card", maturity: installment.maturity } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(response.status).toBe(200);
        const json = (await response.json()) as CardActivity[];
        const item = json.find(({ id }) => id === "cryptomate-installments");
        assert.ok(item, "expected cryptomate installments transaction");
        expect(item.cardId).toBe("first-activity-card");
        expect(item.lastFour).toBe("1234");
        assert.ok("borrow" in item && "installments" in item.borrow, "expected installments borrow");
        expect(item.borrow.installments).toStrictEqual([
          {
            amount: expect.any(Number) as unknown,
            current: 2,
            fee: expect.any(Number) as unknown,
            maturity: Number(installment.maturity),
            rate: expect.any(Number) as unknown,
          },
        ]);
      } finally {
        await database.delete(transactions).where(eq(transactions.id, "cryptomate-installments"));
      }
    });

    it("returns empty card activity for unmatched maturity", async () => {
      expect.hasAssertions();
      const response = await appClient.index.$get(
        { query: { include: "card", maturity: "0" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual([]);
    });

    it("returns statement pdf", async () => {
      expect.hasAssertions();
      const response = await appClient.index.$get(
        { query: { maturity } },
        { headers: { "test-credential-id": "bob", accept: "application/pdf" } },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      const body = await response.arrayBuffer();
      expect(body.byteLength).toBeGreaterThan(0);
      const directory = path.join("node_modules/@exactly/.runtime");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, `statement-${Date.now()}.pdf`), new Uint8Array(body)); // eslint-disable-line security/detect-non-literal-fs-filename -- test artifact path includes timestamp
    });

    it("returns statement pdf with mixed borrow operations", async () => {
      const hash = activity
        .flatMap((item) => ("operations" in item ? item.operations : []))
        .find((operation) => "borrow" in operation && "installments" in operation.borrow)?.transactionHash;
      assert.ok(hash, "expected installments transaction hash");
      try {
        await database.insert(transactions).values([
          {
            id: "panda-mixed-operations",
            cardId: "first-activity-card",
            hashes: [hash, padHex("0xdeb17", { size: 32 })],
            payload: {
              type: "panda",
              bodies: ["created", "completed"].map((action) => ({
                action,
                resource: "transaction",
                createdAt: new Date(0).toISOString(),
                body: {
                  id: "panda-mixed-operations",
                  spend: { ...spendTemplate, merchantCity: null, amount: 100, localAmount: 100, localCurrency: "usd" },
                },
              })),
            },
          },
        ]);
        const response = await appClient.index.$get(
          { query: { maturity } },
          { headers: { "test-credential-id": "bob", accept: "application/pdf" } },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/pdf");
        const body = await response.arrayBuffer();
        expect(body.byteLength).toBeGreaterThan(0);
      } finally {
        await database.delete(transactions).where(eq(transactions.id, "panda-mixed-operations"));
      }
    });

    it("returns statement pdf for combined accept header", async () => {
      expect.hasAssertions();
      const response = await appClient.index.$get(
        { query: { maturity } },
        { headers: { "test-credential-id": "bob", accept: "application/pdf, */*" } },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      const body = await response.arrayBuffer();
      expect(body.byteLength).toBeGreaterThan(0);
    });

    it("returns json when pdf quality is zero", async () => {
      expect.hasAssertions();
      const response = await appClient.index.$get(
        { query: { maturity } },
        { headers: { "test-credential-id": "bob", accept: "application/json, application/pdf;q=0" } },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(Array.isArray(await response.json())).toBe(true);
    });

    it("scopes maturity transaction lookup to user cards", async () => {
      expect.hasAssertions();
      const before = await appClient.index.$get(
        { query: { include: "card", maturity } },
        { headers: { "test-credential-id": "bob" } },
      );
      const borrows = await anvilClient.getContractEvents({
        abi: marketAbi,
        eventName: "BorrowAtMaturity",
        address: marketUSDCAddress,
        args: { borrower: account },
        toBlock: "latest",
        fromBlock: 0n,
        strict: true,
      });
      const borrowHashes = new Set(
        borrows
          .filter(({ args: { maturity: eventMaturity } }) => eventMaturity === BigInt(maturity))
          .map(({ transactionHash }) => transactionHash),
      );
      const transactionsByHash = await database.query.transactions.findMany({
        columns: { hashes: true, payload: true },
      });
      const source = transactionsByHash.find(({ hashes }) => hashes.some((hash) => borrowHashes.has(hash as Hash)));
      assert.ok(source, "expected source transaction");

      const leak = {
        cardId: `leak-card-${Date.now()}`,
        credentialId: `leak-credential-${Date.now()}`,
        transactionId: `leak-transaction-${Date.now()}`,
      };
      try {
        await database.insert(credentials).values({
          id: leak.credentialId,
          publicKey: new Uint8Array(),
          account: padHex("0xac71", { size: 20 }),
          factory: exaAccountFactoryAddress,
        });
        await database.insert(cards).values([{ id: leak.cardId, credentialId: leak.credentialId, lastFour: "0000" }]);
        await database
          .insert(transactions)
          .values([{ id: leak.transactionId, cardId: leak.cardId, hashes: source.hashes, payload: source.payload }]);
        const baseline = (await before.json()) as unknown[];
        const after = await appClient.index.$get(
          { query: { include: "card", maturity } },
          { headers: { "test-credential-id": "bob" } },
        );
        expect((await after.json()) as unknown[]).toHaveLength(baseline.length);
      } finally {
        await database.delete(transactions).where(eq(transactions.id, leak.transactionId));
        await database.delete(cards).where(eq(cards.id, leak.cardId));
        await database.delete(credentials).where(eq(credentials.id, leak.credentialId));
      }
    });
  });

  describe("onchain", () => {
    it("returns deposits", async () => {
      const response = await appClient.index.$get(
        { query: { include: "received" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject([
        { type: "received", currency: "WETH", amount: 1, usdAmount: 2500 },
        { type: "received", currency: "USDC", amount: 69_420, usdAmount: 69_420 },
        { type: "received", currency: "EXA", amount: 666, usdAmount: 3330 },
      ]);
    });

    it("sorts same-block deposits by log index", async () => {
      const owner = createWalletClient({
        chain,
        transport: http(),
        account: privateKeyToAccount(generatePrivateKey()),
      });
      const depositor = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner.account.address), y: zeroHash });
      await Promise.all([
        anvilClient.setBalance({ address: owner.account.address, value: 10n ** 24n }),
        database.insert(credentials).values({
          id: owner.account.address,
          publicKey: new Uint8Array(),
          account: depositor,
          factory: exaAccountFactoryAddress,
        }),
      ]);
      await anvilClient.waitForTransactionReceipt({
        hash: await owner.writeContract({
          address: exaAccountFactoryAddress,
          abi: exaAccountFactoryAbi,
          functionName: "createAccount",
          args: [0n, [{ x: hexToBigInt(owner.account.address), y: 0n }]],
        }),
      });
      const { logs } = await anvilClient.waitForTransactionReceipt({
        hash: await owner.writeContract({
          address: depositor,
          abi: upgradeableModularAccountAbi,
          functionName: "executeBatch",
          args: [
            [
              {
                target: usdcAddress,
                value: 0n,
                data: encodeFunctionData({
                  abi: [
                    {
                      type: "function",
                      name: "mint",
                      inputs: [{ type: "address" }, { type: "uint256" }],
                      outputs: [],
                      stateMutability: "nonpayable",
                    },
                  ],
                  functionName: "mint",
                  args: [depositor, 5_000_000n],
                }),
              },
              {
                target: usdcAddress,
                value: 0n,
                data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: "approve",
                  args: [marketUSDCAddress, 5_000_000n],
                }),
              },
              ...Array.from({ length: 5 }, () => ({
                target: marketUSDCAddress,
                value: 0n,
                data: encodeFunctionData({
                  abi: marketAbi,
                  functionName: "deposit",
                  args: [1_000_000n, depositor],
                }),
              })),
            ],
          ],
        }),
      });
      const deposits = parseEventLogs({ abi: marketAbi, eventName: "Deposit", logs });

      expect(new Set(deposits.map(({ logIndex }) => String(logIndex).length))).toStrictEqual(new Set([1, 2]));

      const response = await appClient.index.$get(
        { query: { include: "received" } },
        { headers: { "test-credential-id": owner.account.address } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject(
        deposits.toReversed().map(({ blockNumber, transactionIndex, logIndex }) => ({
          id: `${chain.id}:${blockNumber}:${transactionIndex}:${logIndex}`,
          type: "received",
          currency: "USDC",
          amount: 1,
        })),
      );
    });

    it("keeps received events deduplicated when maturity is provided", async () => {
      expect.hasAssertions();
      const repays = await anvilClient.getContractEvents({
        abi: marketAbi,
        eventName: "RepayAtMaturity",
        address: [...markets],
        args: { borrower: account },
        toBlock: "latest",
        fromBlock: 0n,
        strict: true,
      });
      assert.ok(repays[0], "expected at least one RepayAtMaturity event");
      const response = await appClient.index.$get(
        { query: { include: "received", maturity: String(repays[0].args.maturity) } },
        { headers: { "test-credential-id": "bob" } },
      );
      expect(response.status).toBe(200);

      const repayHashes = new Set(repays.map(({ transactionHash }) => transactionHash));
      const received = (await response.json()) as { transactionHash: Hash; type: "received" }[];
      expect(received.every(({ transactionHash }) => !repayHashes.has(transactionHash))).toBe(true);
    });

    it("returns repays", async () => {
      const response = await appClient.index.$get(
        { query: { include: "repay" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject([
        {
          type: "repay",
          currency: "USDC",
          amount: expect.withinRange(13, 18),
          usdAmount: expect.withinRange(13, 18),
        },
        { amount: expect.closeTo(81, 0.5), currency: "USDC", type: "repay", usdAmount: expect.closeTo(81, 0.5) }, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        {
          type: "repay",
          currency: "USDC",
          amount: expect.withinRange(418, 421),
          usdAmount: expect.withinRange(418, 421),
        },
      ]);
    });

    it("returns withdraws", async () => {
      const response = await appClient.index.$get(
        { query: { include: "sent" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(response.status).toBe(200);

      await expect(response.json()).resolves.toMatchObject(
        expect.arrayContaining([
          expect.objectContaining({
            amount: 0.01,
            currency: "WETH",
            type: "sent",
            usdAmount: 25,
            receiver: padHex("0x69", { size: 20 }),
          }),
          expect.objectContaining({
            amount: 69,
            currency: "USDC",
            type: "sent",
            usdAmount: 69,
            receiver: padHex("0x69", { size: 20 }),
          }),
        ]),
      );
    });
  });

  it("returns everything", async () => {
    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "bob" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject(
      expect.arrayContaining([
        expect.objectContaining({ type: "received" }),
        expect.objectContaining({ type: "sent" }),
        expect.objectContaining({ type: "repay" }),
        expect.objectContaining({ type: "card" }),
        expect.objectContaining({ type: "panda" }),
      ]),
    );
  });

  describe("declined transactions", () => {
    it("parses declined transaction with created action", () => {
      const result = safeParse(PandaActivity, {
        type: "panda",
        hashes: [zeroHash],
        borrows: [null],
        bodies: [
          {
            action: "created",
            createdAt: "2024-01-15T10:30:00.000Z",
            status: "declined",
            reason: "insufficient funds",
            body: {
              id: "declined-tx-1",
              spend: { ...spendTemplate, amount: 1000, localAmount: 1000, localCurrency: "usd" },
            },
          },
        ],
      });

      expect(result.success).toBe(true);
      assert.ok(result.success);
      expect(result.output).toStrictEqual({
        id: "declined-tx-1",
        type: "panda",
        status: "declined",
        reason: "insufficient funds",
        currency: "USD",
        amount: 10,
        usdAmount: 10,
        merchant: {
          name: "once",
          city: "Buenos Aires",
          country: "ARG",
          icon: undefined,
          state: "",
        },
        operations: [],
        timestamp: "2024-01-15T10:30:00.000Z",
      });
    });

    it.each([
      ["blocked mcc", "transaction declined", "this merchant is not accepted"],
      [
        "advertising services (mcc 7311) transaction velocity limit reached, more than 40 transactions were attempted within a 24-hour period",
        "transaction declined",
        "advertising limit reached",
      ],
      [
        "atm (mcc 6011) transaction velocity limit reached, more than 3 transactions were attempted within a 24-hour period",
        "transaction declined",
        "atm limit reached",
      ],
      [
        "automatic fuel dispenser velocity limit reached, more than 2 transactions were attempted within a 3-day period",
        "transaction declined",
        "fuel limit reached",
      ],
      [
        "block atm (mcc 6011) transaction exceeding 250.00 usd",
        "transaction declined",
        "atm limit reached. maximum 250 usd per transaction.",
      ],
      ["card spending limit exceeded", "transaction declined", "card limit exceeded"],
      ["invalid pin attempt limit exceeded", "too many invalid pin attempts", "too many invalid pin attempts"],
      ["webhook declined", "webhook declined", "transaction declined"],
    ])("maps raw %s over stored reason %s", (declinedReason, storedReason, reason) => {
      const result = safeParse(PandaActivity, {
        type: "panda",
        hashes: [zeroHash],
        borrows: [null],
        bodies: [
          {
            action: "created",
            createdAt: "2024-01-15T10:30:00.000Z",
            status: "declined",
            reason: storedReason,
            body: {
              id: "declined-tx-raw-reason",
              spend: { ...spendTemplate, declinedReason },
            },
          },
        ],
      });

      expect(result.success).toBe(true);
      assert.ok(result.success);
      expect(result.output.reason).toBe(reason);
    });

    it("uses the raw reason for an unknown decline", () => {
      const result = safeParse(PandaActivity, {
        type: "panda",
        hashes: [zeroHash],
        borrows: [null],
        bodies: [
          {
            action: "created",
            createdAt: "2024-01-15T10:30:00.000Z",
            status: "declined",
            body: {
              id: "declined-tx-unknown-reason",
              spend: { ...spendTemplate, declinedReason: "unknown provider decline" },
            },
          },
        ],
      });

      expect(result.success).toBe(true);
      assert.ok(result.success);
      expect(result.output.reason).toBe("unknown provider decline");
    });

    it("hides a legacy webhook decline without a requested operation", () => {
      const result = safeParse(PandaActivity, {
        type: "panda",
        hashes: [zeroHash],
        borrows: [null],
        bodies: [
          {
            action: "created",
            createdAt: "2024-01-15T10:30:00.000Z",
            status: "declined",
            reason: "webhook declined",
            body: {
              id: "declined-tx-legacy-webhook",
              spend: { ...spendTemplate },
            },
          },
        ],
      });

      expect(result.success).toBe(true);
      assert.ok(result.success);
      expect(result.output.reason).toBe("transaction declined");
    });

    it("uses the requested raw reason for a webhook-declined created operation", () => {
      const result = safeParse(PandaActivity, {
        type: "panda",
        hashes: [zeroHash, zeroHash],
        borrows: [null, null],
        bodies: [
          {
            action: "requested",
            createdAt: "2024-01-15T10:59:00.000Z",
            status: "declined",
            body: {
              id: "declined-tx-local-reason",
              spend: { ...spendTemplate, declinedReason: "frozenCard" },
            },
          },
          {
            action: "created",
            createdAt: "2024-01-15T11:00:00.000Z",
            status: "declined",
            body: {
              id: "declined-tx-local-reason",
              spend: { ...spendTemplate, declinedReason: "webhook declined" },
            },
          },
        ],
      });

      expect(result.success).toBe(true);
      assert.ok(result.success);
      expect(result.output.reason).toBe("frozen card");
    });

    it("ignores a non-declined requested operation when finding a decline reason", () => {
      const result = safeParse(PandaActivity, {
        type: "panda",
        hashes: [zeroHash],
        borrows: [null],
        bodies: [
          {
            action: "created",
            createdAt: "2024-01-15T11:00:00.000Z",
            status: "declined",
            body: {
              id: "declined-tx-pending-request",
              spend: { ...spendTemplate, status: "declined", declinedReason: "webhook declined" },
            },
          },
          {
            action: "requested",
            status: "pending",
            createdAt: "2024-01-15T10:59:00.000Z",
            body: {
              id: "declined-tx-pending-request",
              spend: { ...spendTemplate, status: "pending" },
            },
          },
        ],
      });

      expect(result.success).toBe(true);
      assert.ok(result.success);
      expect(result.output.reason).toBe("transaction declined");
    });

    it("hides an unknown local requested reason", () => {
      const result = safeParse(PandaActivity, {
        type: "panda",
        hashes: [zeroHash, zeroHash],
        borrows: [null, null],
        bodies: [
          {
            action: "requested",
            createdAt: "2024-01-15T10:59:00.000Z",
            status: "declined",
            body: {
              id: "declined-tx-local-unknown",
              spend: { ...spendTemplate, declinedReason: "bad collection" },
            },
          },
          {
            action: "created",
            createdAt: "2024-01-15T11:00:00.000Z",
            status: "declined",
            body: {
              id: "declined-tx-local-unknown",
              spend: { ...spendTemplate, status: "declined", declinedReason: "webhook declined" },
            },
          },
        ],
      });

      expect(result.success).toBe(true);
      assert.ok(result.success);
      expect(result.output.reason).toBe("transaction declined");
    });

    it("parses declined transaction with requested action alongside created", () => {
      const result = safeParse(PandaActivity, {
        type: "panda",
        hashes: [zeroHash, zeroHash],
        borrows: [null, null],
        bodies: [
          {
            action: "created",
            createdAt: "2024-01-15T11:00:00.000Z",
            status: "declined",
            reason: "merchant blocked",
            body: {
              id: "declined-tx-2",
              spend: { ...spendTemplate, amount: 500, localAmount: 500, localCurrency: "usd" },
            },
          },
          {
            action: "requested",
            createdAt: "2024-01-15T10:59:00.000Z",
            status: "declined",
            reason: "merchant blocked",
            body: {
              id: "declined-tx-2",
              spend: { ...spendTemplate, amount: 500, localAmount: 500, localCurrency: "usd" },
            },
          },
        ],
      });

      expect(result.success).toBe(true);
      assert.ok(result.success);
      expect(result.output).toStrictEqual({
        id: "declined-tx-2",
        type: "panda",
        status: "declined",
        reason: "merchant blocked",
        currency: "USD",
        amount: 5,
        usdAmount: 5,
        merchant: {
          name: "once",
          city: "Buenos Aires",
          country: "ARG",
          icon: undefined,
          state: "",
        },
        operations: [],
        timestamp: "2024-01-15T11:00:00.000Z",
      });
    });
  });
});

vi.mock("@sentry/node", { spy: true });

afterEach(() => {
  vi.restoreAllMocks();
});

const spendTemplate = {
  amount: 1e4,
  authorizedAmount: 11,
  authorizationMethod: "Normal presentment",
  cardId: "ea4dd7e7-0774-431f-9871-5e4da9322505",
  cardType: "virtual",
  currency: "usd",
  enrichedMerchantIcon: "https://storage.googleapis.com/icon/icon.png",
  localAmount: 1e4,
  localCurrency: "ARS",
  merchantCategory: "once - once",
  merchantCategoryCode: "once",
  merchantCity: "Buenos Aires",
  merchantCountry: "ARG",
  merchantName: "once",
  status: "pending",
  userEmail: "nic@exact.ly",
  userFirstName: "ALEXANDER J",
  userId: "f5eb6ea9-e9ba-4e2f-b16a-94a99f32385c",
  userLastName: "SAMPLEapproved",
};

function retried(createdAt: number) {
  return {
    id: "retried-event",
    chainId: 10,
    action: "created",
    resource: "transaction",
    createdAt: new Date(createdAt).toISOString(),
    body: {
      id: "retried",
      type: "spend",
      spend: { ...spendTemplate, amount: 23_253, localAmount: 23_253, localCurrency: "usd" },
    },
  };
}
