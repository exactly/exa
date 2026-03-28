import "../mocks/onesignal";
import "../mocks/sentry";

import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { previewerAbi, previewerAddress } from "@exactly/common/generated/chain";
import { MATURITY_INTERVAL } from "@exactly/lib";

import { closeQueue, processor, queue, scheduleMaturityChecks } from "../../utils/maturity";
import * as onesignal from "../../utils/onesignal";
import { close as closeRedis } from "../../utils/redis";

import type { CheckDebts } from "../../utils/maturity";
import type { Job } from "bullmq";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  readContract: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@sentry/node", async (importOriginal) => {
  const module = await importOriginal();
  if (typeof module !== "object" || module === null) return { captureException: mocks.captureException };
  return { ...module, captureException: mocks.captureException };
});

vi.mock("../../database", () => ({
  default: { query: { credentials: { findMany: mocks.findMany } } },
  credentials: { account: "account" },
}));

vi.mock("../../utils/publicClient", () => ({
  default: { readContract: mocks.readContract },
}));

function mockAccounts(accounts: { account: string }[]) {
  mocks.findMany.mockReset().mockResolvedValueOnce(accounts).mockResolvedValueOnce([]);
}

function mockExactly(
  result: { fixedBorrowPositions: { maturity: bigint; position: { fee: bigint; principal: bigint } }[] }[],
) {
  mocks.readContract.mockResolvedValue(result);
}

function makeJob(name: string, data: Partial<CheckDebts>): Job<CheckDebts, unknown> {
  return { name, data } as unknown as Job<CheckDebts, unknown>;
}

let testRedis: Redis;

describe("worker", () => {
  const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

  beforeAll(() => {
    if (!process.env.REDIS_URL) throw new Error("missing REDIS_URL");
    testRedis = new Redis(process.env.REDIS_URL);
  });

  afterAll(async () => {
    await closeQueue();
    await closeRedis();
    await testRedis.quit();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await testRedis.flushdb();
  });

  it("schedules maturity checks", async () => {
    await scheduleMaturityChecks();
    const jobs = await queue.getJobs(["delayed", "waiting"]);
    expect(jobs).toHaveLength(2);
    expect(jobs.map((index) => (index.data as CheckDebts).window).toSorted()).toStrictEqual(["1h", "24h"]);
  });

  it("processes check-debts job with debt in single market", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = Math.floor(Date.now() / 1000) + 1800;
    const window = "24h";

    mockAccounts([{ account }]);
    mockExactly([{ fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] }]);

    await processor(makeJob("check-debts", { maturity, window }));

    expect(mocks.readContract).toHaveBeenCalledWith({
      address: previewerAddress,
      abi: previewerAbi,
      functionName: "exactly",
      args: [account],
    });
    const key = `notification:sent:${account}:${String(maturity)}:${window}`;
    const value = await testRedis.get(key);
    expect(value).not.toBeNull();
    const ttl = await testRedis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86_400);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: { en: "Debt Maturity Alert" },
      contents: { en: "Your debt is due in 24 hours. Repay now to avoid liquidation." },
    });
  });

  it("handles duplicate notification", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = Math.floor(Date.now() / 1000) + 1800;
    const window = "24h";

    mockAccounts([{ account }]);
    await testRedis.set(`notification:sent:${account}:${String(maturity)}:${window}`, String(Date.now()), "EX", 86_400);

    mockExactly([{ fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] }]);

    await processor(makeJob("check-debts", { maturity, window }));

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("handles position with principal = 0", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = Math.floor(Date.now() / 1000) + 1800;

    mockAccounts([{ account }]);
    mockExactly([{ fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 0n, fee: 0n } }] }]);

    await processor(makeJob("check-debts", { maturity, window: "24h" }));

    const keys = await testRedis.keys("notification:sent:*");
    expect(keys).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("handles account with no debt in any market", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = Math.floor(Date.now() / 1000) + 1800;

    mockAccounts([{ account }]);
    mockExactly([{ fixedBorrowPositions: [] }, { fixedBorrowPositions: [] }]);

    await processor(makeJob("check-debts", { maturity, window: "24h" }));

    const keys = await testRedis.keys("notification:sent:*");
    expect(keys).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("detects debt across any market", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = Math.floor(Date.now() / 1000) + 1800;
    const window = "24h";

    mockAccounts([{ account }]);
    mockExactly([
      { fixedBorrowPositions: [] },
      { fixedBorrowPositions: [] },
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 50n, fee: 0n } }] },
    ]);

    await processor(makeJob("check-debts", { maturity, window }));

    const key = `notification:sent:${account}:${String(maturity)}:${window}`;
    const value = await testRedis.get(key);
    expect(value).not.toBeNull();
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: { en: "Debt Maturity Alert" },
      contents: { en: "Your debt is due in 24 hours. Repay now to avoid liquidation." },
    });
  });

  it("throws on any rpc failure", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = Math.floor(Date.now() / 1000) + 1800;

    mockAccounts([{ account }]);
    mocks.readContract.mockRejectedValue(new Error("rpc error"));

    await expect(processor(makeJob("check-debts", { maturity, window: "24h" }))).rejects.toThrow("rpc error");

    expect(mocks.captureException).not.toHaveBeenCalledWith(expect.any(Error), { extra: { account } });
    const keys = await testRedis.keys("notification:sent:*");
    expect(keys).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("throws on notification failure so bullmq retries", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = Math.floor(Date.now() / 1000) + 1800;
    const window = "24h";
    const { captureException } = mocks;

    mockAccounts([{ account }]);
    mockExactly([{ fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] }]);
    sendPushNotification.mockRejectedValueOnce(new Error("onesignal error"));

    await expect(processor(makeJob("check-debts", { maturity, window }))).rejects.toThrow("notification failures");

    expect(sendPushNotification).toHaveBeenCalledOnce();
    const key = `notification:sent:${account}:${String(maturity)}:${window}`;
    const value = await testRedis.get(key);
    expect(value).toBeNull();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), { level: "error" });
  });

  it("preserves 1h window when 24h window is stale on schedule", async () => {
    const now = Math.floor(Date.now() / 1000);
    const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    vi.spyOn(Date, "now").mockReturnValue((nextMaturity - 2 * 3600) * 1000);
    try {
      await scheduleMaturityChecks();
      const jobs = await queue.getJobs(["delayed", "waiting"]);
      const windows = jobs.map((index) => (index.data as CheckDebts).window).toSorted();
      const maturities = jobs.map((index) => (index.data as CheckDebts).maturity);
      expect(windows).toStrictEqual(["1h"]);
      expect(maturities).toStrictEqual([nextMaturity]);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("advances past stale maturities on schedule", async () => {
    const now = Math.floor(Date.now() / 1000);
    const staleMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    vi.spyOn(Date, "now").mockReturnValue((staleMaturity + 1) * 1000);
    try {
      await scheduleMaturityChecks(staleMaturity - MATURITY_INTERVAL);
      const jobs = await queue.getJobs(["delayed", "waiting"]);
      const staleJobs = jobs.filter((index) => (index.data as CheckDebts).maturity === staleMaturity);
      expect(staleJobs).toHaveLength(0);
      const advancedJobs = jobs.filter(
        (index) => (index.data as CheckDebts).maturity === staleMaturity + MATURITY_INTERVAL,
      );
      expect(advancedJobs).toHaveLength(2);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("does not fail job when scheduleMaturityChecks throws in finally", async () => {
    const { captureException } = mocks;
    const now = Math.floor(Date.now() / 1000);
    const jobMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;

    mocks.findMany.mockReset().mockResolvedValueOnce([]);

    const addSpy = vi.spyOn(queue, "add").mockRejectedValue(new Error("redis down"));

    await expect(processor(makeJob("check-debts", { maturity: jobMaturity, window: "1h" }))).resolves.not.toThrow();

    expect(captureException).toHaveBeenCalledWith(expect.any(Error), { level: "fatal" });
    addSpy.mockRestore();
  });

  it("throws for unknown job name", async () => {
    await expect(processor(makeJob("unknown", {}))).rejects.toThrow("Unknown job name: unknown");
  });

  it("reschedules after processing any window", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jobMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;

    mocks.findMany.mockReset().mockResolvedValueOnce([]);

    await processor(makeJob("check-debts", { maturity: jobMaturity, window: "1h" }));

    const expectedNextMaturity = jobMaturity + MATURITY_INTERVAL;
    let jobs = await queue.getJobs(["delayed", "waiting"]);
    expect(jobs).toHaveLength(2);
    let windows = jobs.map((index) => {
      const data = index.data as CheckDebts;
      return { maturity: data.maturity, window: data.window };
    });
    expect(windows).toContainEqual({ maturity: expectedNextMaturity, window: "24h" });
    expect(windows).toContainEqual({ maturity: expectedNextMaturity, window: "1h" });

    await testRedis.flushdb();
    mocks.findMany.mockReset().mockResolvedValueOnce([]);

    await processor(makeJob("check-debts", { maturity: jobMaturity, window: "24h" }));

    jobs = await queue.getJobs(["delayed", "waiting"]);
    expect(jobs).toHaveLength(2);
    windows = jobs.map((index) => {
      const data = index.data as CheckDebts;
      return { maturity: data.maturity, window: data.window };
    });
    expect(windows).toContainEqual({ maturity: expectedNextMaturity, window: "24h" });
    expect(windows).toContainEqual({ maturity: expectedNextMaturity, window: "1h" });
  });

  it("skips stale job when maturity is in the past", async () => {
    const maturity = Math.floor(Date.now() / 1000) - 3600;

    await processor(makeJob("check-debts", { maturity, window: "24h" }));

    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});
