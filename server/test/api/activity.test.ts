import "../mocks/sentry";
import "../mocks/auth";
import "../mocks/database";
import "../mocks/deployments";
import "../expect";

import deriveAddress from "@exactly/common/deriveAddress";
import { captureException } from "@sentry/node";
import { testClient } from "hono/testing";
import { safeParse, type InferOutput } from "valibot";
import { zeroHash, padHex, type Hash, zeroAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import app, { CreditActivity, DebitActivity, InstallmentsActivity, PandaActivity } from "../../api/activity";
import database, { cards, credentials, transactions } from "../../database";
import { marketAbi } from "../../generated/contracts";
import anvilClient from "../anvilClient";

const appClient = testClient(app);

describe.concurrent("validation", () => {
  beforeAll(async () => {
    await database
      .insert(credentials)
      .values([{ id: "cred", publicKey: new Uint8Array(), account: zeroAddress, factory: zeroAddress }]);
  });

  it("fails with no auth", async () => {
    const response = await appClient.index.$get();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toBe("unauthorized");
  });

  it("fails with bad credential", async () => {
    const response = await appClient.index.$get(undefined, { headers: { "test-credential-id": "bad" } });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toBe("credential not found");
  });

  it("succeeds with valid credential", async () => {
    const response = await appClient.index.$get(
      { query: { include: "card" } },
      { headers: { "test-credential-id": "cred" } },
    );

    expect(response.status).toBe(200);
  });
});

describe.concurrent("authenticated", () => {
  const bob = privateKeyToAddress(padHex("0xb0b"));
  const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob), y: zeroHash });

  beforeAll(async () => {
    await database
      .insert(credentials)
      .values([{ id: account, publicKey: new Uint8Array(), account, factory: zeroAddress }]);
  });

  describe.sequential("card", () => {
    let activity: InferOutput<
      typeof DebitActivity | typeof CreditActivity | typeof InstallmentsActivity | typeof PandaActivity
    >[];

    beforeAll(async () => {
      await database.insert(cards).values([{ id: "activity", credentialId: account, lastFour: "1234" }]);
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
      activity = await Promise.all(
        logs
          .reduce((map, { args, transactionHash, blockNumber, eventName }) => {
            const data = map.get(transactionHash);
            if (!data) return map.set(transactionHash, { blockNumber, eventName, events: [args] });
            data.events.push(args);
            return map;
          }, new Map<Hash, { blockNumber: bigint; eventName: string; events: (typeof logs)[number]["args"][] }>())
          .entries()
          .map(async ([hash, { blockNumber, eventName, events }], index) => {
            const blockTimestamp = timestamps.get(blockNumber)!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
            const total = events.reduce((sum, { assets }) => sum + assets, 0n);
            const payload =
              index % 2 === 0
                ? {
                    bodies: [
                      {
                        body: {
                          id: String(index),
                          type: "spend",
                          spend: {
                            amount: Number(total) / 1e4,
                            authorizedAmount: 11,
                            authorizationMethod: "Normal presentment",
                            cardId: "ea4dd7e7-0774-431f-9871-5e4da9322505",
                            cardType: "virtual",
                            currency: "usd",
                            enrichedMerchantIcon: "https://storage.googleapis.com/icon/icon.png",
                            localAmount: (1200 * Number(total)) / 1e4,
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
                          },
                        },
                        action: "created",
                        resource: "transaction",
                        createdAt: new Date(Number(blockTimestamp) * 1000).toISOString(),
                      },
                    ],
                    merchant: {
                      city: "Buenos Aires",
                      country: "Argentina",
                      name: "Apple Store",
                    },
                    type: "panda",
                  }
                : {
                    operation_id: String(index),
                    type: "cryptomate",
                    data: {
                      created_at: new Date(Number(blockTimestamp) * 1000).toISOString(),
                      bill_amount: Number(total) / 1e6,
                      transaction_amount: (1200 * Number(total)) / 1e6,
                      transaction_currency_code: "ARS",
                      merchant_data: { name: "Merchant", country: "ARG", city: "Buenos Aires", state: "BA" },
                    },
                  };
            await database
              .insert(transactions)
              .values({ id: String(index), cardId: "activity", hashes: [hash], payload });

            const panda = safeParse(PandaActivity, {
              ...(payload as object),
              hashes: [hash],
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
          }),
      ).then((results) => results.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)));
    });

    it("returns the card transaction", async () => {
      const response = await appClient.index.$get(
        { query: { include: "card" } },
        { headers: { "test-credential-id": account } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual(activity);
    });

    it("reports bad transaction", async () => {
      await database.insert(transactions).values([{ id: "69", cardId: "activity", hashes: ["0x1"], payload: {} }]);
      const response = await appClient.index.$get(
        { query: { include: "card" } },
        { headers: { "test-credential-id": account } },
      );

      expect(captureException).toHaveBeenCalledOnce();
      expect(captureException).toHaveBeenCalledWith(
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
        { headers: { "test-credential-id": account } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject([
        { type: "received", currency: "WETH", amount: 1, usdAmount: 2500 },
        { type: "received", currency: "USDC", amount: 69_420, usdAmount: 69_420 },
        { type: "received", currency: "EXA", amount: 666, usdAmount: 666 },
        { type: "received", currency: "EXA", amount: 666, usdAmount: 666 },
      ]);
    });

    it("returns repays", async () => {
      const response = await appClient.index.$get(
        { query: { include: "repay" } },
        { headers: { "test-credential-id": account } },
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
        { headers: { "test-credential-id": account } },
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

    it("returns rollovers", async () => {
      const response = await appClient.index.$get(
        { query: { include: "rollover" } },
        { headers: { "test-credential-id": account } },
      );

      await expect(response.json()).resolves.toMatchObject([
        {
          currency: "USDC",
          borrow: { currency: "USDC", maturity: expect.withinRange(1, Infinity), type: "borrow" },
          repay: { currency: "USDC", maturity: expect.withinRange(1, Infinity), type: "repay" },
          type: "rollover",
        },
      ]);
      expect(response.status).toBe(200);
    });
  });

  it("returns liquidations", async () => {
    const response = await appClient.index.$get(
      { query: { include: "liquidated" } },
      { headers: { "test-credential-id": account } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject([
      {
        type: "liquidated",
        currency: "USDC",
        amount: expect.withinRange(60, 61),
        usdAmount: expect.withinRange(60, 61),
        seizedMarket: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
      },
    ]);
  });

  it("returns everything", async () => {
    const response = await appClient.index.$get({}, { headers: { "test-credential-id": account } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      expect.arrayContaining([
        expect.objectContaining({ type: "received" }),
        expect.objectContaining({ type: "sent" }),
        expect.objectContaining({ type: "repay" }),
        expect.objectContaining({ type: "card" }),
        expect.objectContaining({ type: "panda" }),
        expect.objectContaining({ type: "rollover" }),
      ]),
    );
  });
});

vi.mock("@sentry/node", { spy: true });

afterEach(() => vi.resetAllMocks());
