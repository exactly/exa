import "../mocks/sentry";
import "../mocks/auth";
import "../mocks/deployments";
import "../expect";

import deriveAddress from "@exactly/common/deriveAddress";
import { marketAbi } from "@exactly/common/generated/chain";
import { captureException } from "@sentry/node";
import { testClient } from "hono/testing";
import { safeParse, type InferOutput } from "valibot";
import { zeroHash, padHex, type Hash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import app, { CreditActivity, DebitActivity, InstallmentsActivity, PandaActivity } from "../../api/activity";
import database, { cards, transactions } from "../../database";
import anvilClient from "../anvilClient";

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
    let activity: InferOutput<
      typeof DebitActivity | typeof CreditActivity | typeof InstallmentsActivity | typeof PandaActivity
    >[];

    beforeAll(async () => {
      await database.insert(cards).values([{ id: "activity", credentialId: "bob", lastFour: "1234" }]);
      const logs = [
        ...(await anvilClient.getContractEvents({
          abi: marketAbi,
          eventName: "BorrowAtMaturity",
          address: [inject("MarketEXA"), inject("MarketUSDC"), inject("MarketWETH")],
          args: { borrower: account },
          toBlock: "latest",
          fromBlock: 0n,
          strict: true,
        })),
        ...(await anvilClient.getContractEvents({
          abi: marketAbi,
          eventName: "Withdraw",
          address: [inject("MarketEXA"), inject("MarketUSDC"), inject("MarketWETH")],
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
                      type: "spend",
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
          cardId: "activity",
          hashes,
          payload,
          hash,
          blockNumber,
          eventName,
          events,
          blockTimestamp,
        };
      });

      await database
        .insert(transactions)
        .values(txs.map(({ id, cardId, hashes, payload }) => ({ id, cardId, hashes, payload })));

      activity = txs
        .map(({ hashes, payload, hash, blockNumber, eventName, events, blockTimestamp }) => {
          const panda = safeParse(PandaActivity, {
            ...(payload as object),
            hashes,
            borrows: eventName === "Withdraw" ? [null] : [{ blockNumber, events }],
          });
          if (panda.success) return panda.output;
          const eventCount = eventName === "Withdraw" ? 0 : events.length;
          const cryptomate = safeParse({ 0: DebitActivity, 1: CreditActivity }[eventCount] ?? InstallmentsActivity, {
            ...(payload as object),
            hash,
            events: eventCount > 0 ? events : undefined,
            blockTimestamp: eventCount > 0 ? blockTimestamp : undefined,
          });
          if (cryptomate.success) return cryptomate.output;
          throw new Error("bad test setup");
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
    }, 66_666);

    it("returns the card transaction", async () => {
      const response = await appClient.index.$get(
        { query: { include: "card" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual(activity);
    });

    it("reports bad transaction", async () => {
      await database
        .insert(transactions)
        .values([{ id: "bad-transaction", cardId: "activity", hashes: ["0x1"], payload: {} }]);
      const response = await appClient.index.$get(
        { query: { include: "card" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(captureException).toHaveBeenCalledExactlyOnceWith(
        new Error("bad transaction"),
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          contexts: expect.objectContaining({
            cryptomate: expect.objectContaining({ issues: expect.anything() }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
            panda: expect.objectContaining({ issues: expect.anything() }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          }),
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual(activity);
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

    it("returns repays", async () => {
      const response = await appClient.index.$get(
        { query: { include: "repay" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject([
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
});

vi.mock("@sentry/node", { spy: true });

afterEach(() => {
  vi.clearAllMocks();
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
