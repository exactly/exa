import "../mocks/onesignal";
import "../mocks/sentry";

import { Queue } from "bullmq";
import { like } from "drizzle-orm";
import { parse } from "valibot";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { previewerAbi, previewerAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL } from "@exactly/lib";

import database, { credentials } from "../../database";
import { closeQueue, scheduleMaturityChecks } from "../../utils/maturity";
import * as onesignal from "../../utils/onesignal";
import redis, { close as closeRedis, queue as queueRedis } from "../../utils/redis";

import type * as sentry from "@sentry/node";

const mocks = vi.hoisted(() => ({
  addBreadcrumb: vi.fn<typeof sentry.addBreadcrumb>(),
  readContract: vi.fn(),
  captureException: vi.fn<typeof sentry.captureException>(),
}));

vi.mock("@sentry/node", async (importOriginal) => {
  const module = await importOriginal();
  if (typeof module !== "object" || module === null)
    return { addBreadcrumb: mocks.addBreadcrumb, captureException: mocks.captureException };
  return { ...module, addBreadcrumb: mocks.addBreadcrumb, captureException: mocks.captureException };
});

vi.mock("../../utils/publicClient", () => ({
  default: { readContract: mocks.readContract },
}));

const queue = new Queue<{ maturity?: number; window: "1h" | "24h" }>("maturity", { connection: queueRedis });
type Markets = { fixedBorrowPositions: { maturity: bigint; position: { fee: bigint; principal: bigint } }[] }[];

function insertAccounts(accounts: Address[]) {
  return database.insert(credentials).values(
    accounts.map((account, index) => ({
      id: `maturity-test-${index}`,
      publicKey: new Uint8Array(),
      factory: account,
      account,
    })),
  );
}

function mockExactly(account: Address, markets: Markets) {
  mockExactlyMany([[account, markets]]);
}

function mockExactlyMany(entries: [Address, Markets][]) {
  mocks.readContract.mockImplementation(({ args }: { args: [Address] }) =>
    Promise.resolve(new Map(entries).get(args[0]) ?? []),
  );
}

function expectedNotification(userId: Address, window: "1h" | "24h") {
  return {
    userId,
    headings: {
      en: "Payment due soon",
      es: "Vencimiento próximo", // cspell:ignore Vencimiento próximo
      pt: "Vencimento próximo", // cspell:ignore Vencimento próximo
    },
    contents: {
      en:
        window === "24h"
          ? "Your debt is due in 24 hours. Repay now to avoid penalties."
          : "Your debt is due in 1 hour. Repay now to avoid penalties.",
      es:
        window === "24h"
          ? "Tu deuda vence en 24 horas. Repágala ahora para evitar penalidades."
          : "Tu deuda vence en 1 hora. Repágala ahora para evitar penalidades.", // cspell:ignore deuda vence Repágala ahora evitar penalidades
      pt:
        window === "24h"
          ? "Sua dívida vence em 24 horas. Pague agora para evitar penalidades."
          : "Sua dívida vence em 1 hora. Pague agora para evitar penalidades.", // cspell:ignore dívida vence Pague evitar penalidades
    },
  };
}

function maturityFor(window: "1h" | "24h") {
  return Math.floor(Date.now() / 1000) + (window === "24h" ? 24 * 3600 - 1800 : 57 * 60);
}

async function jobDone(name: string, data: { maturity?: number; window: "1h" | "24h" }) {
  const job = await queue.add(name, data, { attempts: 1 });
  if (!job.id) throw new Error("job id missing");

  for (let index = 0; index < 500; index += 1) {
    const state = await job.getState();
    if (state === "completed") return;
    if (state === "failed") {
      const failedJob = await queue.getJob(job.id);
      throw new Error(failedJob?.failedReason ?? "job failed");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("job timed out");
}

describe("worker", () => {
  const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

  afterAll(async () => {
    await queue.close();
    await closeQueue();
    await closeRedis();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    const keys = await redis.keys("notification:sent:*");
    if (keys.length > 0) await redis.del(...keys);
    await Promise.all(["check-debts-24h", "check-debts-1h"].map((id) => queue.removeJobScheduler(id)));
    await queue.obliterate({ force: true });
    await database.delete(credentials).where(like(credentials.id, "maturity-test-%"));
  });

  it("schedules maturity checks", async () => {
    const now = Math.floor(Date.now() / 1000);
    const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    vi.spyOn(Date, "now").mockReturnValue((nextMaturity - 25 * 3600) * 1000);
    try {
      await scheduleMaturityChecks();
      const jobs = await queue.getJobs(["delayed", "waiting"]);
      await expect(queue.getJobScheduler("check-debts-24h")).resolves.toMatchObject({
        key: "check-debts-24h",
        name: "check-debts",
        every: MATURITY_INTERVAL * 1000,
        next: (nextMaturity - 24 * 3600) * 1000,
        startDate: (nextMaturity - 24 * 3600) * 1000,
        template: { data: { window: "24h" } },
      });
      await expect(queue.getJobScheduler("check-debts-1h")).resolves.toMatchObject({
        key: "check-debts-1h",
        name: "check-debts",
        every: MATURITY_INTERVAL * 1000,
        next: (nextMaturity - 3600) * 1000,
        startDate: (nextMaturity - 3600) * 1000,
        template: { data: { window: "1h" } },
      });
      expect(jobs).toHaveLength(2);
      expect(jobs.map((index) => index.data.window).toSorted()).toStrictEqual(["1h", "24h"]);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("processes check-debts job with debt in single market", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await insertAccounts([account]);
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
    expect(sendPushNotification).toHaveBeenCalledWith(expectedNotification(account, window));
  });

  it("handles duplicate notification", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await insertAccounts([account]);
    await redis.set(`notification:sent:${account}:${String(maturity)}:${window}`, String(Date.now()), "EX", 86_400);

    mockExactly(account, [
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] },
    ]);

    await jobDone("check-debts", { maturity, window });

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("ignores position with principal = 0 and fee = 0", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = maturityFor("24h");

    await insertAccounts([account]);
    mockExactly(account, [
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 0n, fee: 0n } }] },
    ]);

    await jobDone("check-debts", { maturity, window: "24h" });

    const keys = await redis.keys("notification:sent:*");
    expect(keys).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("handles position with principal = 0 and fee > 0", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await insertAccounts([account]);
    mockExactly(account, [
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 0n, fee: 1n } }] },
    ]);

    await jobDone("check-debts", { maturity, window });

    await expect(redis.get(`notification:sent:${account}:${String(maturity)}:${window}`)).resolves.not.toBeNull();
    expect(sendPushNotification).toHaveBeenCalledWith(expectedNotification(account, window));
  });

  it("handles account with no debt in any market", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = maturityFor("24h");

    await insertAccounts([account]);
    mockExactly(account, [{ fixedBorrowPositions: [] }, { fixedBorrowPositions: [] }]);

    await jobDone("check-debts", { maturity, window: "24h" });

    const keys = await redis.keys("notification:sent:*");
    expect(keys).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("detects debt across any market", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await insertAccounts([account]);
    mockExactly(account, [
      { fixedBorrowPositions: [] },
      { fixedBorrowPositions: [] },
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 50n, fee: 0n } }] },
    ]);

    await jobDone("check-debts", { maturity, window });

    const key = `notification:sent:${account}:${String(maturity)}:${window}`;
    await expect(redis.get(key)).resolves.not.toBeNull();
    expect(sendPushNotification).toHaveBeenCalledOnce();
  });

  it("uses the 1h wording path", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "1h";
    const maturity = maturityFor(window);

    await insertAccounts([account]);
    mockExactly(account, [
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] },
    ]);

    await jobDone("check-debts", { maturity, window });

    await expect(redis.get(`notification:sent:${account}:${String(maturity)}:${window}`)).resolves.not.toBeNull();
    expect(sendPushNotification).toHaveBeenCalledWith(expectedNotification(account, window));
  });

  it("derives maturity for scheduled jobs", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const now = Math.floor(Date.now() / 1000);
    const maturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    vi.spyOn(Date, "now").mockReturnValue((maturity - 57 * 60) * 1000);
    try {
      await insertAccounts([account]);
      mockExactly(account, [
        { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] },
      ]);

      await jobDone("check-debts", { window: "1h" });

      await expect(redis.get(`notification:sent:${account}:${String(maturity)}:1h`)).resolves.not.toBeNull();
      expect(sendPushNotification).toHaveBeenCalledWith(expectedNotification(account, "1h"));
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("continues processing when an rpc call fails", async () => {
    const first = parse(Address, "0x1234567890123456789012345678901234567890");
    const second = parse(Address, "0x1234567890123456789012345678901234567891");
    const window = "24h";
    const maturity = maturityFor(window);

    await insertAccounts([first, second]);
    mocks.readContract.mockImplementation(({ args }: { args: [Address] }) => {
      if (args[0] === first) return Promise.reject(new Error("rpc error"));
      return Promise.resolve(
        args[0] === second
          ? [{ fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] }]
          : [],
      );
    });

    await expect(jobDone("check-debts", { maturity, window })).resolves.toBeUndefined();

    expect(sendPushNotification).toHaveBeenCalledOnce();
    await expect(redis.get(`notification:sent:${second}:${String(maturity)}:${window}`)).resolves.not.toBeNull();
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      extra: { account: first, kind: "rpc", maturity, window },
    });
  });

  it("captures notification failures without failing the job", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await insertAccounts([account]);
    mockExactly(account, [
      { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] },
    ]);
    sendPushNotification.mockRejectedValueOnce(new Error("onesignal error"));

    await expect(jobDone("check-debts", { maturity, window })).resolves.toBeUndefined();

    expect(sendPushNotification).toHaveBeenCalledOnce();
    const key = `notification:sent:${account}:${String(maturity)}:${window}`;
    await expect(redis.get(key)).resolves.toBeNull();
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      extra: { account, kind: "notification", maturity, window },
    });
  });

  it("reports rpc and notification failure counts", async () => {
    const first = parse(Address, "0x1234567890123456789012345678901234567890");
    const second = parse(Address, "0x1234567890123456789012345678901234567891");
    const window = "24h";
    const maturity = maturityFor(window);

    await insertAccounts([first, second]);
    mocks.readContract.mockImplementation(({ args }: { args: [Address] }) => {
      if (args[0] === first) return Promise.reject(new Error("rpc error"));
      return Promise.resolve(
        args[0] === second
          ? [{ fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] }]
          : [],
      );
    });
    sendPushNotification.mockRejectedValueOnce(new Error("onesignal error"));

    await expect(jobDone("check-debts", { maturity, window })).resolves.toBeUndefined();

    const breadcrumb = mocks.addBreadcrumb.mock.calls
      .map(([entry]) => entry)
      .find((entry) => entry.category === "maturity-queue" && entry.message === "processed accounts");

    expect(breadcrumb).toMatchObject({
      category: "maturity-queue",
      message: "processed accounts",
      level: "info",
    });
    expect(breadcrumb?.data).toMatchObject({ notificationFailures: 1, rpcFailures: 1 });
  });

  it("processes chunk plus one accounts", async () => {
    const window = "24h";
    const maturity = maturityFor(window);
    const accounts = Array.from({ length: 51 }, (_, index) =>
      parse(
        Address,
        `0x${BigInt(index + 4096)
          .toString(16)
          .padStart(40, "0")}`,
      ),
    );

    await insertAccounts(accounts);
    mockExactlyMany(
      accounts.map((account): [Address, Markets] => [
        account,
        [{ fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] }],
      ]),
    );

    await jobDone("check-debts", { maturity, window });

    expect(sendPushNotification).toHaveBeenCalledTimes(51);
    await expect(redis.get(`notification:sent:${accounts[50]}:${String(maturity)}:${window}`)).resolves.not.toBeNull();
  });

  it("schedules the next 24h window when the current one already passed", async () => {
    const now = Math.floor(Date.now() / 1000);
    const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    vi.spyOn(Date, "now").mockReturnValue((nextMaturity - 2 * 3600) * 1000);
    try {
      await scheduleMaturityChecks();
      await expect(queue.getJobScheduler("check-debts-24h")).resolves.toMatchObject({
        every: MATURITY_INTERVAL * 1000,
        next: (nextMaturity + MATURITY_INTERVAL - 24 * 3600) * 1000,
        startDate: (nextMaturity + MATURITY_INTERVAL - 24 * 3600) * 1000,
        template: { data: { window: "24h" } },
      });
      await expect(queue.getJobScheduler("check-debts-1h")).resolves.toMatchObject({
        every: MATURITY_INTERVAL * 1000,
        next: (nextMaturity - 3600) * 1000,
        startDate: (nextMaturity - 3600) * 1000,
        template: { data: { window: "1h" } },
      });
      await expect(
        queue.getJobs(["delayed", "waiting"]).then((jobs) => jobs.map((index) => index.data.window).toSorted()),
      ).resolves.toStrictEqual(["1h", "24h"]);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("keeps scheduling when startup is inside the final hour", async () => {
    const now = Math.floor(Date.now() / 1000);
    const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    vi.spyOn(Date, "now").mockReturnValue((nextMaturity - 30 * 60) * 1000);
    try {
      await scheduleMaturityChecks();
      await expect(queue.getJobScheduler("check-debts-24h")).resolves.toMatchObject({
        every: MATURITY_INTERVAL * 1000,
        next: (nextMaturity + MATURITY_INTERVAL - 24 * 3600) * 1000,
        startDate: (nextMaturity + MATURITY_INTERVAL - 24 * 3600) * 1000,
        template: { data: { window: "24h" } },
      });
      await expect(queue.getJobScheduler("check-debts-1h")).resolves.toMatchObject({
        every: MATURITY_INTERVAL * 1000,
        next: (nextMaturity + MATURITY_INTERVAL - 3600) * 1000,
        startDate: (nextMaturity + MATURITY_INTERVAL - 3600) * 1000,
        template: { data: { window: "1h" } },
      });
      await expect(
        queue.getJobs(["delayed", "waiting"]).then((jobs) => jobs.map((index) => index.data.window).toSorted()),
      ).resolves.toStrictEqual(["1h", "24h"]);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("throws for unknown job name", async () => {
    await expect(jobDone("unknown", { maturity: 0, window: "1h" })).rejects.toThrow("Unknown job name: unknown");
  });

  it("skips stale job when maturity is in the past", async () => {
    const maturity = Math.floor(Date.now() / 1000) - 3600;

    await jobDone("check-debts", { maturity, window: "24h" });

    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("skips delayed 24h reminder jobs", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const now = Math.floor(Date.now() / 1000);
    const maturity = now + 6 * 3600;
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    try {
      await insertAccounts([account]);
      mockExactly(account, [
        { fixedBorrowPositions: [{ maturity: BigInt(maturity), position: { principal: 100n, fee: 0n } }] },
      ]);

      await jobDone("check-debts", { maturity, window: "24h" });

      expect(sendPushNotification).not.toHaveBeenCalled();
      await expect(redis.keys("notification:sent:*")).resolves.toHaveLength(0);
      expect(mocks.addBreadcrumb).toHaveBeenCalledWith({
        category: "maturity-queue",
        message: "stale job skipped",
        level: "warning",
        data: { maturity, window: "24h", now, remaining: 6 * 3600 },
      });
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });
});
