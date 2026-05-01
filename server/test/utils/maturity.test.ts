import "../mocks/onesignal";
import "../mocks/sentry";

import { like } from "drizzle-orm";
import { parse } from "valibot";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { previewerAbi, previewerAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL } from "@exactly/lib";

import database, { credentials } from "../../database";
import { closeQueue, queue, scheduleMaturityChecks, worker } from "../../utils/maturity";
import * as onesignal from "../../utils/onesignal";
import redis, { close as closeRedis } from "../../utils/redis";

import type { CheckDebts } from "../../utils/maturity";

const mocks = vi.hoisted(() => ({
  readContract: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@sentry/node", async (importOriginal) => {
  const module = await importOriginal();
  if (typeof module !== "object" || module === null) return { captureException: mocks.captureException };
  return { ...module, captureException: mocks.captureException };
});

vi.mock("../../utils/publicClient", () => ({
  default: { readContract: mocks.readContract },
}));

async function insertAccounts(accounts: { account: Address }[]) {
  await database.insert(credentials).values(
    accounts.map(({ account }, index) => ({
      id: `maturity-test-${index}`,
      publicKey: new Uint8Array(),
      factory: account,
      account,
    })),
  );
}

function mockExactly(
  account: Address,
  result: { fixedBorrowPositions: { maturity: bigint; position: { fee: bigint; principal: bigint } }[] }[],
) {
  mocks.readContract.mockImplementation(({ args }: { args: [Address] }) =>
    Promise.resolve(args[0] === account ? result : []),
  );
}

function jobDone(name: string, data: CheckDebts) {
  return new Promise<void>((resolve, reject) => {
    worker.once("completed", () => {
      resolve();
    });
    worker.once("failed", (_: unknown, error: Error) => {
      reject(error);
    });
    queue.add(name, data, { attempts: 1 }).catch(reject);
  });
}

describe("worker", () => {
  const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

  afterAll(async () => {
    await closeQueue();
    await closeRedis();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await redis.flushdb();
    await database.delete(credentials).where(like(credentials.id, "maturity-test-%"));
  });

  it("schedules maturity checks", async () => {
    const now = Math.floor(Date.now() / 1000);
    const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    vi.spyOn(Date, "now").mockReturnValue((nextMaturity - 25 * 3600) * 1000);
    try {
      await scheduleMaturityChecks();
      const jobs = await queue.getJobs(["delayed", "waiting"]);
      expect(jobs).toHaveLength(2);
      expect(jobs.map((index) => index.data.window).toSorted()).toStrictEqual(["1h", "24h"]);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("processes check-debts job with debt in single market", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = Math.floor(Date.now() / 1000) + 1800;
    const window = "24h";

    await insertAccounts([{ account }]);
    mockExactly(account, [
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] },
    ]);

    await jobDone("check-debts", { maturity, window });

    expect(mocks.readContract).toHaveBeenCalledWith({
      address: previewerAddress,
      abi: previewerAbi,
      functionName: "exactly",
      args: [account],
    });
    const key = `notification:sent:${account}:${String(maturity)}:${window}`;
    await expect(redis.get(key)).resolves.not.toBeNull();
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86_400);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: {
        en: "Debt Maturity Alert",
        es: "Alerta de vencimiento de deuda",
        pt: "Alerta de vencimento de dívida",
      }, // cspell:ignore Alerta vencimiento deuda vencimento dívida
      contents: {
        en: "Your debt is due in 24 hours. Repay now to avoid liquidation.",
        es: "Tu deuda vence en 24 horas. Repágala ahora para evitar la liquidación.", // cspell:ignore deuda vence repágala ahora evitar liquidación
        pt: "Sua dívida vence em 24 horas. Pague agora para evitar a liquidação.", // cspell:ignore dívida vence liquidação Pague
      },
    });
  });

  it("handles duplicate notification", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = Math.floor(Date.now() / 1000) + 1800;
    const window = "24h";

    await insertAccounts([{ account }]);
    await redis.set(`notification:sent:${account}:${String(maturity)}:${window}`, String(Date.now()), "EX", 86_400);

    mockExactly(account, [
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] },
    ]);

    await jobDone("check-debts", { maturity, window });

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("handles position with principal = 0", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = Math.floor(Date.now() / 1000) + 1800;

    await insertAccounts([{ account }]);
    mockExactly(account, [
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 0n, fee: 0n } }] },
    ]);

    await jobDone("check-debts", { maturity, window: "24h" });

    const keys = await redis.keys("notification:sent:*");
    expect(keys).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("handles account with no debt in any market", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = Math.floor(Date.now() / 1000) + 1800;

    await insertAccounts([{ account }]);
    mockExactly(account, [{ fixedBorrowPositions: [] }, { fixedBorrowPositions: [] }]);

    await jobDone("check-debts", { maturity, window: "24h" });

    const keys = await redis.keys("notification:sent:*");
    expect(keys).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("detects debt across any market", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = Math.floor(Date.now() / 1000) + 1800;
    const window = "24h";

    await insertAccounts([{ account }]);
    mockExactly(account, [
      { fixedBorrowPositions: [] },
      { fixedBorrowPositions: [] },
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 50n, fee: 0n } }] },
    ]);

    await jobDone("check-debts", { maturity, window });

    const key = `notification:sent:${account}:${String(maturity)}:${window}`;
    await expect(redis.get(key)).resolves.not.toBeNull();
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: {
        en: "Debt Maturity Alert",
        es: "Alerta de vencimiento de deuda",
        pt: "Alerta de vencimento de dívida",
      }, // cspell:ignore Alerta vencimiento deuda vencimento dívida
      contents: {
        en: "Your debt is due in 24 hours. Repay now to avoid liquidation.",
        es: "Tu deuda vence en 24 horas. Repágala ahora para evitar la liquidación.", // cspell:ignore deuda vence repágala ahora evitar liquidación
        pt: "Sua dívida vence em 24 horas. Pague agora para evitar a liquidação.", // cspell:ignore dívida vence liquidação Pague
      },
    });
  });

  it("throws on any rpc failure", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = Math.floor(Date.now() / 1000) + 1800;

    await insertAccounts([{ account }]);
    mocks.readContract.mockRejectedValue(new Error("rpc error"));

    await expect(jobDone("check-debts", { maturity, window: "24h" })).rejects.toThrow("rpc error");

    expect(mocks.captureException).not.toHaveBeenCalledWith(expect.any(Error), { extra: { account } });
    const keys = await redis.keys("notification:sent:*");
    expect(keys).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("throws on notification failure so bullmq retries", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = Math.floor(Date.now() / 1000) + 1800;
    const window = "24h";

    await insertAccounts([{ account }]);
    mockExactly(account, [
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] },
    ]);
    sendPushNotification.mockRejectedValueOnce(new Error("onesignal error"));

    await expect(jobDone("check-debts", { maturity, window })).rejects.toThrow("notification failures");

    expect(sendPushNotification).toHaveBeenCalledOnce();
    const key = `notification:sent:${account}:${String(maturity)}:${window}`;
    await expect(redis.get(key)).resolves.toBeNull();
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), { level: "error" });
  });

  it("preserves 1h window when 24h window is stale on schedule", async () => {
    const now = Math.floor(Date.now() / 1000);
    const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    vi.spyOn(Date, "now").mockReturnValue((nextMaturity - 2 * 3600) * 1000);
    try {
      await scheduleMaturityChecks();
      const jobs = await queue.getJobs(["delayed", "waiting"]);
      const windows = jobs.map((index) => index.data.window).toSorted();
      const maturities = jobs.map((index) => index.data.maturity);
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
      const staleJobs = jobs.filter((index) => index.data.maturity === staleMaturity);
      expect(staleJobs).toHaveLength(0);
      const advancedJobs = jobs.filter((index) => index.data.maturity === staleMaturity + MATURITY_INTERVAL);
      expect(advancedJobs).toHaveLength(2);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("does not fail job when scheduleMaturityChecks throws in finally", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jobMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;

    const originalAdd = queue.add.bind(queue);
    const addSpy = vi
      .spyOn(queue, "add")
      .mockImplementationOnce(originalAdd)
      .mockRejectedValue(new Error("redis down"));

    await expect(jobDone("check-debts", { maturity: jobMaturity, window: "1h" })).resolves.not.toThrow();

    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), { level: "fatal" });
    addSpy.mockRestore();
  });

  it("throws for unknown job name", async () => {
    await expect(jobDone("unknown", { maturity: 0, window: "1h" })).rejects.toThrow("Unknown job name: unknown");
  });

  it("reschedules after processing any window", async () => {
    const now = Math.floor(Date.now() / 1000);
    const jobMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;

    await jobDone("check-debts", { maturity: jobMaturity, window: "1h" });

    const expectedNextMaturity = jobMaturity + MATURITY_INTERVAL;
    let jobs = await queue.getJobs(["delayed", "waiting"]);
    expect(jobs).toHaveLength(2);
    let windows = jobs.map((index) => {
      const data = index.data;
      return { maturity: data.maturity, window: data.window };
    });
    expect(windows).toContainEqual({ maturity: expectedNextMaturity, window: "24h" });
    expect(windows).toContainEqual({ maturity: expectedNextMaturity, window: "1h" });

    await redis.flushdb();
    await database.delete(credentials).where(like(credentials.id, "maturity-test-%"));

    await jobDone("check-debts", { maturity: jobMaturity, window: "24h" });

    jobs = await queue.getJobs(["delayed", "waiting"]);
    expect(jobs).toHaveLength(2);
    windows = jobs.map((index) => {
      const data = index.data;
      return { maturity: data.maturity, window: data.window };
    });
    expect(windows).toContainEqual({ maturity: expectedNextMaturity, window: "24h" });
    expect(windows).toContainEqual({ maturity: expectedNextMaturity, window: "1h" });
  });

  it("skips stale job when maturity is in the past", async () => {
    const maturity = Math.floor(Date.now() / 1000) - 3600;

    await jobDone("check-debts", { maturity, window: "24h" });

    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});
