import "../expect";

import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import assert from "node:assert";
import { safeParse, type InferOutput } from "valibot";
import { padHex, parseEventLogs, zeroHash, type Hash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain, { marketAbi } from "@exactly/common/generated/chain";
import { MATURITY_INTERVAL } from "@exactly/lib";

import app, { CreditActivity, DebitActivity, InstallmentsActivity, PandaActivity } from "../../api/activity";
import database, { cards, credentials, transactions } from "../../database";
import anvilClient from "../anvilClient";

import type * as accountStatement from "../../utils/AccountStatement";
import type * as statement from "../../utils/Statement";

const mocks = vi.hoisted(() => ({
  accountStatement: vi.fn<(properties: Parameters<typeof accountStatement.default>[0]) => void>(),
  statement: vi.fn<(properties: Parameters<typeof statement.default>[0]) => void>(),
}));

vi.mock("../../utils/AccountStatement", async (importOriginal) => {
  const module = await importOriginal<typeof accountStatement>();
  return {
    ...module,
    default: (properties: Parameters<typeof module.default>[0]) => {
      mocks.accountStatement(properties);
      return module.default(properties);
    },
  };
});

vi.mock("../../utils/Statement", async (importOriginal) => {
  const module = await importOriginal<typeof statement>();
  return {
    ...module,
    default: (properties: Parameters<typeof module.default>[0]) => {
      mocks.statement(properties);
      return module.default(properties);
    },
  };
});

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

const appClient = testClient(app);
const account = deriveAddress(inject("ExaAccountFactory"), {
  x: padHex(privateKeyToAddress(padHex("0xb0b"))),
  y: zeroHash,
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
  describe.sequential("card", () => {
    type CardActivity = InferOutput<
      typeof CreditActivity | typeof DebitActivity | typeof InstallmentsActivity | typeof PandaActivity
    > & { cardId: string; lastFour: string };
    let activity: CardActivity[];
    let installment: { hash: Hash; maturity: string };
    let maturity: string;
    let amount: number;
    let purchaseId: string;
    let creditPurchaseId: string;
    let repayment: { hash: Hash; logIndex: number };

    beforeAll(async () => {
      await database.insert(cards).values([
        { id: "first-activity-card", credentialId: "bob", lastFour: "1234" },
        { id: "second-activity-card", credentialId: "bob", lastFour: "6789" },
      ]);
      const borrows = await anvilClient
        .getContractEvents({
          abi: marketAbi,
          eventName: "BorrowAtMaturity",
          address: [inject("MarketEXA"), inject("MarketUSDC"), inject("MarketWETH")],
          args: { borrower: account },
          toBlock: "latest",
          fromBlock: 0n,
          strict: true,
        })
        .then((events) => events.toSorted(order));
      assert.ok(borrows[0], "expected at least one BorrowAtMaturity event");
      maturity = String(borrows[0].args.maturity);
      amount = Number(borrows[0].args.assets) / 1e6;
      const repayments = await anvilClient.getContractEvents({
        abi: marketAbi,
        eventName: "RepayAtMaturity",
        address: inject("MarketUSDC"),
        args: { borrower: account },
        toBlock: "latest",
        fromBlock: 0n,
        strict: true,
      });
      const selected = repayments.find(({ args }) => args.maturity === BigInt(maturity));
      assert.ok(selected, "expected repayment for the selected maturity");
      repayment = { hash: selected.transactionHash, logIndex: selected.logIndex };
      const logs = [
        ...borrows,
        ...(await anvilClient
          .getContractEvents({
            abi: marketAbi,
            eventName: "Withdraw",
            address: [inject("MarketEXA"), inject("MarketUSDC"), inject("MarketWETH")],
            args: { owner: account },
            toBlock: "latest",
            fromBlock: 0n,
            strict: true,
          })
          .then((events) => events.toSorted(order))),
      ];
      const receipts = await Promise.all(
        [...new Set(logs.map(({ transactionHash }) => transactionHash))].map(async (transactionHash) => ({
          transactionHash,
          receipt: await anvilClient.getTransactionReceipt({ hash: transactionHash }),
        })),
      );
      const receiptHash = receipts.find(
        ({ receipt }) =>
          parseEventLogs({
            abi: marketAbi,
            eventName: "BorrowAtMaturity",
            logs: receipt.logs.filter(({ address }) => address.toLowerCase() === inject("MarketUSDC").toLowerCase()),
            strict: true,
          }).length === 0,
      )?.transactionHash;
      assert.ok(receiptHash, "expected a non-borrow receipt hash");
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
          id: "transaction-pending",
          cardId: "first-activity-card",
          lastFour: "1234",
          hashes: [zeroHash],
          hash: zeroHash,
          blockNumber: 0n,
          eventName: "pending",
          events: [],
          blockTimestamp: 0n,
          payload: {
            type: "panda",
            bodies: [
              {
                action: "created",
                resource: "transaction",
                createdAt: new Date(3).toISOString(),
                body: {
                  id: "transaction-pending",
                  spend: { ...spendTemplate, amount: 1500, localAmount: 1500 },
                },
              },
            ],
          },
        },
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
        {
          id: "transaction-refund",
          cardId: "first-activity-card",
          lastFour: "1234",
          hashes: [receiptHash, receiptHash],
          hash: zeroHash,
          blockNumber: 0n,
          eventName: "refund",
          events: [],
          blockTimestamp: 0n,
          payload: {
            type: "panda",
            bodies: [
              {
                action: "created",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-refund",
                  spend: { ...spendTemplate, amount: 0, localAmount: 0 },
                },
              },
              {
                action: "updated",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-refund",
                  spend: { ...spendTemplate, authorizationUpdateAmount: -500, status: "completed" },
                },
              },
            ],
          },
        },
        {
          id: "transaction-completed-refund",
          cardId: "first-activity-card",
          lastFour: "1234",
          hashes: [receiptHash],
          hash: zeroHash,
          blockNumber: 0n,
          eventName: "refund",
          events: [],
          blockTimestamp: 0n,
          payload: {
            type: "panda",
            bodies: [
              {
                action: "completed",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-completed-refund",
                  spend: { ...spendTemplate, amount: -500, localAmount: -500, status: "completed" },
                },
              },
            ],
          },
        },
        {
          id: "transaction-completed-refund-after-created",
          cardId: "first-activity-card",
          lastFour: "1234",
          hashes: [receiptHash, receiptHash],
          hash: zeroHash,
          blockNumber: 0n,
          eventName: "refund",
          events: [],
          blockTimestamp: 0n,
          payload: {
            type: "panda",
            bodies: [
              {
                action: "created",
                resource: "transaction",
                createdAt: new Date((Number(maturity) - 1000) * 1000).toISOString(),
                body: {
                  id: "transaction-completed-refund-after-created",
                  spend: { ...spendTemplate, amount: 2000, localAmount: 2000 },
                },
              },
              {
                action: "completed",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-completed-refund-after-created",
                  spend: {
                    ...spendTemplate,
                    amount: -2000,
                    authorizedAmount: -2000,
                    localAmount: -2000,
                    status: "completed",
                  },
                },
              },
            ],
          },
        },
        {
          id: "transaction-partial-refund",
          cardId: "second-activity-card",
          lastFour: "6789",
          hashes: [receiptHash, receiptHash, receiptHash],
          hash: zeroHash,
          blockNumber: 0n,
          eventName: "partial refund",
          events: [],
          blockTimestamp: 0n,
          payload: {
            type: "panda",
            bodies: [
              {
                action: "created",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-partial-refund",
                  spend: { ...spendTemplate, amount: 1000, localAmount: 1000 },
                },
              },
              {
                action: "completed",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-partial-refund",
                  spend: {
                    ...spendTemplate,
                    amount: 1000,
                    localAmount: 1000,
                    authorizedAmount: 1000,
                    status: "completed",
                  },
                },
              },
              {
                action: "updated",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-partial-refund",
                  spend: { ...spendTemplate, authorizationUpdateAmount: -500, status: "completed" },
                },
              },
            ],
          },
        },
        {
          id: "transaction-settled-after-authorization",
          cardId: "first-activity-card",
          lastFour: "1234",
          hashes: [receiptHash, zeroHash],
          hash: zeroHash,
          blockNumber: 0n,
          eventName: "settlement",
          events: [],
          blockTimestamp: 0n,
          payload: {
            type: "panda",
            bodies: [
              {
                action: "created",
                resource: "transaction",
                createdAt: new Date((Number(maturity) - MATURITY_INTERVAL - 1) * 1000).toISOString(),
                body: {
                  id: "transaction-settled-after-authorization",
                  spend: { ...spendTemplate, amount: 1000, localAmount: 1000 },
                },
              },
              {
                action: "completed",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-settled-after-authorization",
                  spend: { ...spendTemplate, amount: 1000, localAmount: 1000, authorizedAmount: 1000 },
                },
              },
            ],
          },
        },
        {
          id: "transaction-mixed-mode",
          cardId: "first-activity-card",
          lastFour: "1234",
          hashes: [receiptHash, borrows[0].transactionHash],
          hash: borrows[0].transactionHash,
          blockNumber: borrows[0].blockNumber,
          eventName: "mixed mode",
          events: [borrows[0].args],
          blockTimestamp: timestamps.get(borrows[0].blockNumber)!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          payload: {
            type: "panda",
            bodies: [
              {
                action: "created",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-mixed-mode",
                  spend: { ...spendTemplate, amount: 1000, localAmount: 1000 },
                },
              },
              {
                action: "completed",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-mixed-mode",
                  spend: {
                    ...spendTemplate,
                    amount: 1000,
                    authorizedAmount: 1000,
                    localAmount: 1000,
                    status: "completed",
                  },
                },
              },
            ],
          },
        },
        {
          id: "transaction-reversed",
          cardId: "first-activity-card",
          lastFour: "1234",
          hashes: [receiptHash, receiptHash],
          hash: zeroHash,
          blockNumber: 0n,
          eventName: "reversal",
          events: [],
          blockTimestamp: 0n,
          payload: {
            type: "panda",
            bodies: [
              {
                action: "created",
                resource: "transaction",
                createdAt: new Date((Number(maturity) - MATURITY_INTERVAL - 1) * 1000).toISOString(),
                body: {
                  id: "transaction-reversed",
                  spend: { ...spendTemplate, amount: 500, localAmount: 500 },
                },
              },
              {
                action: "updated",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-reversed",
                  spend: { ...spendTemplate, authorizationUpdateAmount: -500, status: "reversed" },
                },
              },
            ],
          },
        },
        {
          id: "transaction-pending-adjustment",
          cardId: "first-activity-card",
          lastFour: "1234",
          hashes: [receiptHash, receiptHash, receiptHash],
          hash: zeroHash,
          blockNumber: 0n,
          eventName: "pending adjustment",
          events: [],
          blockTimestamp: 0n,
          payload: {
            type: "panda",
            bodies: [
              {
                action: "created",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-pending-adjustment",
                  spend: { ...spendTemplate, amount: 2000, localAmount: 2000 },
                },
              },
              {
                action: "updated",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-pending-adjustment",
                  spend: {
                    ...spendTemplate,
                    amount: 1500,
                    localAmount: 1500,
                    authorizationUpdateAmount: -500,
                    status: "pending",
                  },
                },
              },
              {
                action: "completed",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-pending-adjustment",
                  spend: { ...spendTemplate, amount: 1500, localAmount: 1500, authorizedAmount: 1500 },
                },
              },
            ],
          },
        },
        {
          id: "transaction-settled-below-authorization",
          cardId: "first-activity-card",
          lastFour: "1234",
          hashes: [receiptHash, receiptHash],
          hash: zeroHash,
          blockNumber: 0n,
          eventName: "settlement adjustment",
          events: [],
          blockTimestamp: 0n,
          payload: {
            type: "panda",
            bodies: [
              {
                action: "created",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-settled-below-authorization",
                  spend: { ...spendTemplate, amount: 2000, localAmount: 2000 },
                },
              },
              {
                action: "completed",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-settled-below-authorization",
                  spend: { ...spendTemplate, amount: 1500, localAmount: 1500, authorizedAmount: 2000 },
                },
              },
            ],
          },
        },
        {
          id: "transaction-old-charge-period-refund",
          cardId: "first-activity-card",
          lastFour: "1234",
          hashes: [receiptHash, receiptHash, receiptHash],
          hash: zeroHash,
          blockNumber: 0n,
          eventName: "period refund",
          events: [],
          blockTimestamp: 0n,
          payload: {
            type: "panda",
            bodies: [
              {
                action: "created",
                resource: "transaction",
                createdAt: new Date((Number(maturity) - MATURITY_INTERVAL - 1) * 1000).toISOString(),
                body: {
                  id: "transaction-old-charge-period-refund",
                  spend: { ...spendTemplate, amount: 2000, localAmount: 2000 },
                },
              },
              {
                action: "completed",
                resource: "transaction",
                createdAt: new Date((Number(maturity) - MATURITY_INTERVAL - 1) * 1000).toISOString(),
                body: {
                  id: "transaction-old-charge-period-refund",
                  spend: { ...spendTemplate, amount: 2000, localAmount: 2000 },
                },
              },
              {
                action: "updated",
                resource: "transaction",
                createdAt: new Date(Number(maturity) * 1000).toISOString(),
                body: {
                  id: "transaction-old-charge-period-refund",
                  spend: { ...spendTemplate, authorizationUpdateAmount: -500, status: "completed" },
                },
              },
            ],
          },
        },
        periodTransaction(
          "transaction-period-start",
          "period start",
          new Date((Number(maturity) - MATURITY_INTERVAL) * 1000).toISOString(),
          {
            amount: 100,
            localAmount: 100,
          },
        ),
        periodTransaction("transaction-period-end", "period end", new Date(Number(maturity) * 1000).toISOString(), {
          amount: 0,
          localAmount: 0,
        }),
        periodTransaction(
          "transaction-period-outside",
          "period outside",
          new Date((Number(maturity) - MATURITY_INTERVAL - 1) * 1000).toISOString(),
          { amount: 0, localAmount: 0 },
        ),
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
        .toSorted((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
      const operation = activity
        .flatMap((item) => ("operations" in item ? item.operations : []))
        .find((item) => "borrow" in item && "installments" in item.borrow);
      assert.ok(operation && "borrow" in operation && "installments" in operation.borrow, "expected installments");
      const second = operation.borrow.installments[1];
      assert.ok(second, "expected second installment");
      installment = { hash: operation.transactionHash, maturity: String(second.maturity) };
      const purchase = activity.find((item) => {
        if (item.id === "transaction-mixed-mode") return false;
        if ("operations" in item)
          return item.operations.some(({ transactionHash }) => transactionHash === borrows[0]?.transactionHash);
        return item.transactionHash === borrows[0]?.transactionHash;
      });
      assert.ok(purchase, "expected maturity purchase");
      purchaseId = purchase.id;
      const pandaCreditPurchase = activity.find(
        (item) =>
          item.id !== "transaction-mixed-mode" && item.type === "panda" && item.operations.some(({ mode }) => mode > 0),
      );
      assert.ok(pandaCreditPurchase, "expected panda credit purchase");
      creditPurchaseId = pandaCreditPurchase.id;
    }, 66_666);

    it("returns the card transaction", async () => {
      const response = await appClient.index.$get(
        { query: { include: "card" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject(httpSerialize(activity));
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
      mocks.statement.mockClear();
      mocks.accountStatement.mockClear();
      const response = await appClient.index.$get(
        { query: { maturity, include: ["card", "repay"] } },
        { headers: { "test-credential-id": "bob", accept: "application/pdf" } },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      const body = await response.arrayBuffer();
      expect(body.byteLength).toBeGreaterThan(0);
      expect(mocks.statement).toHaveBeenCalledOnce();
      expect(mocks.accountStatement).not.toHaveBeenCalled();
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
            hashes: [hash, zeroHash],
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
          { query: { maturity, include: ["card", "repay"] } },
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
        { query: { maturity, include: ["card", "repay"] } },
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

    it.sequential("rejects account statement pdf without maturity", async () => {
      expect.hasAssertions();
      mocks.statement.mockClear();
      mocks.accountStatement.mockClear();
      const response = await appClient.index.$get(
        {},
        { headers: { "test-credential-id": "bob", accept: "application/pdf" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "maturity required for account statement pdf" });
      expect(mocks.accountStatement).not.toHaveBeenCalled();
      expect(mocks.statement).not.toHaveBeenCalled();
    });

    it.sequential("returns account statement pdf with maturity", async () => {
      expect.hasAssertions();
      mocks.statement.mockClear();
      mocks.accountStatement.mockClear();
      const hash = activity
        .flatMap((item) => ("operations" in item ? item.operations : []))
        .find((operation) => "borrow" in operation)?.transactionHash;
      assert.ok(hash, "expected maturity purchase hash");
      const response = await appClient.index.$get(
        { query: { maturity } },
        { headers: { "test-credential-id": "bob", accept: "application/pdf" } },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(await response.arrayBuffer().then(({ byteLength }) => byteLength)).toBeGreaterThan(0);
      expect(mocks.accountStatement).toHaveBeenCalledOnce();
      expect(mocks.statement).not.toHaveBeenCalled();
      const statement = mocks.accountStatement.mock.calls[0]?.[0];
      assert.ok(statement, "expected account statement properties");
      expect(statement.cards.find(({ cardId }) => cardId === "first-activity-card")).toStrictEqual({
        amount: 75,
        cardId: "first-activity-card",
        lastFour: "1234",
      });
      const second = statement.cards.find(({ cardId }) => cardId === "second-activity-card");
      assert.ok(second, "expected second card summary");
      expect(second.lastFour).toBe("6789");
      expect(typeof second.amount).toBe("number");
      const refundTimestamp = new Date(Number(maturity) * 1000).toISOString();
      expect(
        statement.activities
          .filter(
            ({ id }) => id.startsWith("transaction-completed-refund") || id.startsWith("transaction-partial-refund"),
          )
          .toSorted((a, b) => a.id.localeCompare(b.id)),
      ).toStrictEqual([
        {
          amount: 5,
          detail: "Refund – Card **** 1234",
          id: "transaction-completed-refund",
          timestamp: refundTimestamp,
          title: "once",
        },
        {
          amount: -20,
          detail: "Debit purchase – Card **** 1234",
          id: "transaction-completed-refund-after-created",
          timestamp: new Date((Number(maturity) - 1000) * 1000).toISOString(),
          title: "once",
        },
        {
          amount: 20,
          detail: "Refund – Card **** 1234",
          id: "transaction-completed-refund-after-created:1",
          timestamp: refundTimestamp,
          title: "once",
        },
        {
          amount: -10,
          detail: "Debit purchase – Card **** 6789",
          id: "transaction-partial-refund",
          timestamp: refundTimestamp,
          title: "once",
        },
        {
          amount: 5,
          detail: "Refund – Card **** 6789",
          id: "transaction-partial-refund:1",
          timestamp: refundTimestamp,
          title: "once",
        },
      ]);
      expect(statement.period).toBe(
        new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
          year: "numeric",
        }).formatRange(new Date((Number(maturity) - MATURITY_INTERVAL) * 1000), new Date(Number(maturity) * 1000)),
      );
      expect(statement.activities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ amount: 2500, detail: "1 WETH", title: "Funds added" }),
          expect.objectContaining({
            amount: -25,
            detail: "0.01 WETH",
            title: "Sent to 0x0000...000069",
          }),
        ]),
      );
      const repays = await anvilClient.getContractEvents({
        abi: marketAbi,
        eventName: "RepayAtMaturity",
        address: inject("MarketUSDC"),
        args: { borrower: account },
        toBlock: "latest",
        fromBlock: 0n,
        strict: true,
      });
      const repay = repays.find(
        ({ logIndex, transactionHash }) => transactionHash === repayment.hash && logIndex === repayment.logIndex,
      );
      assert.ok(repay, "expected USDC debt payment");
      const repayBlock = await anvilClient.getBlock({ blockNumber: repay.blockNumber });
      const repayAmount = Number(repay.args.assets) / 1e6;
      const repayId = `${chain.id}:${repay.blockNumber}:${repay.transactionIndex}:${repay.logIndex}`;
      expect(statement.activities.find(({ id }) => id === repayId)).toStrictEqual({
        amount: -repayAmount,
        detail: `${repayAmount} USDC`,
        id: repayId,
        timestamp: new Date(Number(repayBlock.timestamp) * 1000).toISOString(),
        title: "Debt payment",
      });
      expect(
        statement.activities.every(
          ({ timestamp }) =>
            Date.parse(timestamp) / 1000 > Number(maturity) - MATURITY_INTERVAL &&
            Date.parse(timestamp) / 1000 <= Number(maturity),
        ),
      ).toBe(true);
      expect(statement.activities.find(({ id }) => id === purchaseId)).toMatchObject({
        amount: -amount,
        detail: "Credit purchase – Card **** 1234",
      });
      expect(statement.activities.find(({ id }) => id === creditPurchaseId)).toMatchObject({
        detail: "Credit purchase – Card **** 6789",
      });
      expect(statement.activities.find(({ id }) => id === "transaction-mixed-mode")).toMatchObject({
        amount: -10,
        detail: "Debit purchase – Card **** 1234",
      });
      expect(statement.activities.find(({ id }) => id === "transaction-period-start")).toBeUndefined();
      expect(statement.activities.find(({ id }) => id === "transaction-period-end")).toMatchObject({
        timestamp: new Date(Number(maturity) * 1000).toISOString(),
      });
      expect(statement.activities.find(({ id }) => id === "transaction-period-outside")).toBeUndefined();
      expect(statement.activities.find(({ id }) => id === "transaction-settled-after-authorization")).toMatchObject({
        timestamp: new Date(Number(maturity) * 1000).toISOString(),
      });
      expect(statement.activities.find(({ id }) => id === "transaction-reversed")).toBeUndefined();
      expect(statement.activities.find(({ id }) => id === "transaction-settled-below-authorization")).toMatchObject({
        amount: -15,
        detail: "Debit purchase – Card **** 1234",
        timestamp: new Date(Number(maturity) * 1000).toISOString(),
      });
      expect(statement.activities.find(({ id }) => id === "transaction-old-charge-period-refund")).toBeUndefined();
      expect(statement.activities.find(({ id }) => id === "transaction-old-charge-period-refund:1")).toMatchObject({
        amount: 5,
        detail: "Refund – Card **** 1234",
        timestamp: refundTimestamp,
      });
      expect(statement.activities.some(({ id }) => id.startsWith("transaction-settled-below-authorization:"))).toBe(
        false,
      );
      expect(statement.activities.find(({ id }) => id === "transaction-pending-adjustment")).toMatchObject({
        amount: -20,
        detail: "Debit purchase – Card **** 1234",
      });
      expect(statement.activities.find(({ id }) => id === "transaction-pending-adjustment:1")).toBeUndefined();
      expect(statement.activities.map(({ detail }) => detail)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^Credit purchase – Card /),
          expect.stringMatching(/^Debit purchase – Card /),
        ]),
      );
    });

    it.sequential("preserves settled authorization increases", async () => {
      const id = "transaction-settled-after-increase";
      const source = activity.find(({ id: activityId }) => activityId === creditPurchaseId);
      assert.ok(source && "operations" in source, "expected credit purchase");
      const hash = source.operations.find((operation) => "borrow" in operation)?.transactionHash;
      assert.ok(hash, "expected credit purchase hash");
      mocks.accountStatement.mockClear();
      try {
        await database.insert(transactions).values([
          {
            id,
            cardId: "first-activity-card",
            hashes: [hash, hash, hash],
            payload: {
              type: "panda",
              bodies: [
                {
                  action: "created",
                  resource: "transaction",
                  createdAt: new Date(Number(maturity) * 1000).toISOString(),
                  body: { id, spend: { ...spendTemplate, amount: 1000, localAmount: 1000 } },
                },
                {
                  action: "updated",
                  resource: "transaction",
                  createdAt: new Date(Number(maturity) * 1000).toISOString(),
                  body: {
                    id,
                    spend: { ...spendTemplate, amount: 1500, localAmount: 1500, authorizationUpdateAmount: 500 },
                  },
                },
                {
                  action: "completed",
                  resource: "transaction",
                  createdAt: new Date(Number(maturity) * 1000).toISOString(),
                  body: {
                    id,
                    spend: { ...spendTemplate, amount: 1500, localAmount: 1500, authorizedAmount: 1500 },
                  },
                },
              ],
            },
          },
        ]);
        const response = await appClient.index.$get(
          { query: { maturity } },
          { headers: { "test-credential-id": "bob", accept: "application/pdf" } },
        );
        expect(response.status).toBe(200);
        const statement = mocks.accountStatement.mock.calls[0]?.[0];
        assert.ok(statement, "expected account statement properties");
        expect(statement.activities.find(({ id: activityId }) => activityId === id)).toMatchObject({
          amount: -15,
          detail: "Credit purchase – Card **** 1234",
        });
      } finally {
        await database.delete(transactions).where(eq(transactions.id, id));
      }
    });

    it("rejects filtered pdf without maturity", async () => {
      expect.hasAssertions();
      const response = await appClient.index.$get(
        { query: { include: "received" } },
        { headers: { "test-credential-id": "bob", accept: "application/pdf" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "maturity required for filtered pdf" });
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
        address: inject("MarketUSDC"),
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
          factory: inject("ExaAccountFactory"),
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
        expect(await after.json()).toStrictEqual(baseline);
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

    it("keeps received events deduplicated when maturity is provided", async () => {
      expect.hasAssertions();
      const repays = await anvilClient.getContractEvents({
        abi: marketAbi,
        eventName: "RepayAtMaturity",
        address: [inject("MarketEXA"), inject("MarketUSDC"), inject("MarketWETH")],
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
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

    it("uses a generic reason for an unknown raw decline", () => {
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
      expect(result.output.reason).toBe("transaction declined");
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
  vi.mocked(captureException).mockClear();
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

function periodTransaction(id: string, eventName: string, createdAt: string, spend: Partial<typeof spendTemplate>) {
  return {
    id,
    cardId: "first-activity-card",
    lastFour: "1234",
    hashes: [zeroHash],
    hash: zeroHash,
    blockNumber: 0n,
    eventName,
    events: [],
    blockTimestamp: 0n,
    payload: {
      type: "panda",
      bodies: [
        {
          action: "completed",
          resource: "transaction",
          createdAt,
          body: { id, spend: { ...spendTemplate, ...spend } },
        },
      ],
    },
  };
}

function order(
  a: { blockNumber: bigint; logIndex: number; transactionIndex: number },
  b: { blockNumber: bigint; logIndex: number; transactionIndex: number },
) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  if (a.transactionIndex !== b.transactionIndex) return a.transactionIndex - b.transactionIndex;
  return a.logIndex - b.logIndex;
}
