import "../mocks/onesignal";
import "../mocks/sentry";

import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { previewerAbi, previewerAddress } from "@exactly/common/generated/chain";
import { MATURITY_INTERVAL } from "@exactly/lib";

import { closeQueue, MaturityJob, processor, queue, scheduleMaturityChecks } from "../../utils/maturity";
import * as onesignal from "../../utils/onesignal";
import { close as closeRedis } from "../../utils/redis";

import type { CheckDebtsData } from "../../utils/maturity";
import type { Job } from "bullmq";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  readContract: vi.fn(),
}));

vi.mock("../../database", () => ({
  default: { select: mocks.select },
  credentials: { account: "account" },
}));

vi.mock("../../utils/publicClient", () => ({
  default: { readContract: mocks.readContract },
}));

function mockAccounts(accounts: { account: string }[]) {
  const offsetMock = vi.fn().mockResolvedValueOnce(accounts).mockResolvedValueOnce([]);
  const limitMock = vi.fn().mockReturnValue({ offset: offsetMock });
  const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
  const fromMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
  mocks.select.mockReturnValue({ from: fromMock });
}

function mockExactly(
  result: { fixedBorrowPositions: { maturity: bigint; position: { fee: bigint; principal: bigint } }[] }[],
) {
  mocks.readContract.mockResolvedValue(result);
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
    expect(jobs.map((index) => (index.data as CheckDebtsData).window).toSorted()).toStrictEqual(["1h", "24h"]);
  });

  it("processes check-debts job with debt in single market", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = 1_234_567_890;
    const window = "24h";

    mockAccounts([{ account }]);
    mockExactly([{ fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] }]);

    await processor({
      name: MaturityJob.CHECK_DEBTS,
      data: { maturity, window },
    } as unknown as Job<CheckDebtsData, unknown>);

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
    const maturity = 1_234_567_890;
    const window = "24h";

    mockAccounts([{ account }]);
    await testRedis.set(`notification:sent:${account}:${String(maturity)}:${window}`, String(Date.now()), "EX", 86_400);

    mockExactly([{ fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] }]);

    await processor({
      name: MaturityJob.CHECK_DEBTS,
      data: { maturity, window },
    } as unknown as Job<CheckDebtsData, unknown>);

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("handles position with principal = 0", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = 1_234_567_890;

    mockAccounts([{ account }]);
    mockExactly([{ fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 0n, fee: 0n } }] }]);

    await processor({
      name: MaturityJob.CHECK_DEBTS,
      data: { maturity, window: "24h" },
    } as unknown as Job<CheckDebtsData, unknown>);

    const keys = await testRedis.keys("notification:sent:*");
    expect(keys).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("handles account with no debt in any market", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = 1_234_567_890;

    mockAccounts([{ account }]);
    mockExactly([{ fixedBorrowPositions: [] }, { fixedBorrowPositions: [] }]);

    await processor({
      name: MaturityJob.CHECK_DEBTS,
      data: { maturity, window: "24h" },
    } as unknown as Job<CheckDebtsData, unknown>);

    const keys = await testRedis.keys("notification:sent:*");
    expect(keys).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("detects debt across any market", async () => {
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = 1_234_567_890;
    const window = "24h";

    mockAccounts([{ account }]);
    mockExactly([
      { fixedBorrowPositions: [] },
      { fixedBorrowPositions: [] },
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 50n, fee: 0n } }] },
    ]);

    await processor({
      name: MaturityJob.CHECK_DEBTS,
      data: { maturity, window },
    } as unknown as Job<CheckDebtsData, unknown>);

    const key = `notification:sent:${account}:${String(maturity)}:${window}`;
    const value = await testRedis.get(key);
    expect(value).not.toBeNull();
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: { en: "Debt Maturity Alert" },
      contents: { en: "Your debt is due in 24 hours. Repay now to avoid liquidation." },
    });
  });

  it("handles exactly() call failure", async () => {
    const { captureException } = await import("@sentry/node");
    const account = "0x1234567890123456789012345678901234567890";
    const maturity = 1_234_567_890;

    mockAccounts([{ account }]);
    mocks.readContract.mockRejectedValue(new Error("rpc error"));

    await processor({
      name: MaturityJob.CHECK_DEBTS,
      data: { maturity, window: "24h" },
    } as unknown as Job<CheckDebtsData, unknown>);

    expect(captureException).toHaveBeenCalledWith(expect.any(Error), { extra: { account } });
    const keys = await testRedis.keys("notification:sent:*");
    expect(keys).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("should throw an error for unknown job names", async () => {
    const job = { name: "unknown", data: {} } as unknown as Job<CheckDebtsData>;
    await expect(processor(job)).rejects.toThrow("Unknown job name: unknown");
  });

  it("reschedules on 1h window", async () => {
    const jobMaturity = MATURITY_INTERVAL * 10;

    const offsetMock = vi.fn().mockResolvedValueOnce([]);
    const limitMock = vi.fn().mockReturnValue({ offset: offsetMock });
    const orderByMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ orderBy: orderByMock });
    mocks.select.mockReturnValue({ from: fromMock });

    await processor({
      name: MaturityJob.CHECK_DEBTS,
      data: { maturity: jobMaturity, window: "1h" },
    } as unknown as Job<CheckDebtsData, unknown>);

    const expectedNextMaturity = jobMaturity + MATURITY_INTERVAL;
    const jobs = await queue.getJobs(["delayed", "waiting"]);
    expect(jobs).toHaveLength(2);
    const windows = jobs.map((index) => {
      const data = index.data as CheckDebtsData;
      return { maturity: data.maturity, window: data.window };
    });
    expect(windows).toContainEqual({ maturity: expectedNextMaturity, window: "24h" });
    expect(windows).toContainEqual({ maturity: expectedNextMaturity, window: "1h" });
  });
});
