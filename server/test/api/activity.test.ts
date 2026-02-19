import "../expect";

import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeParse, type InferOutput } from "valibot";
import { padHex, zeroHash, type Hash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, assert, beforeAll, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { marketAbi } from "@exactly/common/generated/chain";

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
      typeof CreditActivity | typeof DebitActivity | typeof InstallmentsActivity | typeof PandaActivity
    >[];
    let maturity: string;

    beforeAll(async () => {
      await database.insert(cards).values([{ id: "activity", credentialId: "bob", lastFour: "1234" }]);
      const borrows = await anvilClient.getContractEvents({
        abi: marketAbi,
        eventName: "BorrowAtMaturity",
        address: [inject("MarketEXA"), inject("MarketUSDC"), inject("MarketWETH")],
        args: { borrower: account },
        toBlock: "latest",
        fromBlock: 0n,
        strict: true,
      });
      assert(borrows[0], "expected at least one BorrowAtMaturity event");
      maturity = String(borrows[0].args.maturity);
      const logs = [
        ...borrows,
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
        .toSorted((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
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
      const [before, credentials] = await Promise.all([
        appClient.index.$get({ query: { include: "card", maturity } }, { headers: { "test-credential-id": "bob" } }),
        database.query.credentials.findMany({ columns: { id: true } }),
      ]);
      const otherCredential = credentials.find(({ id }) => id !== "bob");
      assert(otherCredential, "expected another credential");
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
      assert(source, "expected source transaction");

      const leak = {
        cardId: `leak-card-${Date.now()}`,
        transactionId: `leak-transaction-${Date.now()}`,
      };
      try {
        await database.insert(cards).values([{ id: leak.cardId, credentialId: otherCredential.id, lastFour: "0000" }]);
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
      assert(repays[0], "expected at least one RepayAtMaturity event");
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
