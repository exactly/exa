import "../mocks/onesignal";
import "../mocks/sentry";

import { Queue } from "bullmq";
import { like } from "drizzle-orm";
import { parse } from "valibot";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { previewerAbi, previewerAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL, WAD } from "@exactly/lib";

import database, { credentials } from "../../database";
import { closeQueue, reminders } from "../../utils/maturity";
import * as onesignal from "../../utils/onesignal";
import redis, { close as closeRedis, queue as queueRedis } from "../../utils/redis";

import type * as sentry from "@sentry/node";

const mocks = vi.hoisted(() => ({
  addBreadcrumb: vi.fn<typeof sentry.addBreadcrumb>(),
  captureException: vi.fn<typeof sentry.captureException>(),
  readContract: vi.fn(),
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

type Window = "1h" | "24h";
type CheckDebts = { maturity?: number; window: Window };
type SendReminder = { maturity: number; userId: Address; window: Window };
type Position = { maturity: bigint; position: { fee: bigint; principal: bigint } };
type Market = { decimals: number; fixedBorrowPositions: Position[]; usdPrice: bigint };
type Markets = Market[];

const queue = new Queue<CheckDebts>("maturity", { connection: queueRedis });
const notificationQueue = new Queue<SendReminder>("maturity-notifications", { connection: queueRedis });
const USDC = 1_000_000n;
const uuid = /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u;

function market(fixedBorrowPositions: Position[], init: Partial<Omit<Market, "fixedBorrowPositions">> = {}) {
  return { decimals: 6, usdPrice: WAD, fixedBorrowPositions, ...init };
}

function debt(maturity: number, principal = 100n * USDC, fee = 0n) {
  return { maturity: BigInt(maturity), position: { principal, fee } };
}

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

function maturityFor(window: Window) {
  return Math.floor(Date.now() / 1000) + (window === "24h" ? 24 * 3600 - 1800 : 57 * 60);
}

function testAccounts(length: number) {
  return Array.from({ length }, (_, index) =>
    parse(
      Address,
      `0x${BigInt(index + 4096)
        .toString(16)
        .padStart(40, "0")}`,
    ),
  );
}

function nextMaturity() {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
}

function schedulerOffset(window: Window) {
  return (MATURITY_INTERVAL - (window === "24h" ? 24 * 3600 : 3600)) * 1000;
}

function reminderJobId({ maturity, userId, window }: SendReminder) {
  return `maturity-reminder-${userId}-${maturity}-${window}`;
}

function catchUpJobId(maturity: number, window: Window) {
  return `maturity-catch-up-${maturity}-${window}`;
}

async function waitForCompletedJob<T extends object>(target: Queue<T>, id: string) {
  for (let index = 0; index < 500; index += 1) {
    const current = await target.getJob(id);
    if (!current) return;
    const state = await current.getState();
    if (state === "completed") return;
    if (state === "failed") throw new Error(current.failedReason);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("job timed out");
}

async function waitForFailedJob<T extends object>(target: Queue<T>, id: string) {
  for (let index = 0; index < 500; index += 1) {
    const current = await target.getJob(id);
    const state = await current?.getState();
    if (state === "failed") return current;
    if (state === "completed") throw new Error("job completed");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("job timed out");
}

async function checkDone(name: string, data: CheckDebts, attempts = 1) {
  const job = await queue.add(name, data, { attempts, backoff: { type: "fixed", delay: 1 } });
  if (!job.id) throw new Error("job id missing");

  return waitForCompletedJob(queue, job.id);
}

async function reminderDone(data: SendReminder, attempts = 1) {
  const job = await notificationQueue.add("send-maturity-reminder", data, {
    attempts,
    backoff: { type: "fixed", delay: 1 },
    removeOnFail: false,
  });
  if (!job.id) throw new Error("job id missing");

  return waitForCompletedJob(notificationQueue, job.id);
}

async function expectFailedReminder(data: SendReminder, attempts = 1) {
  const job = await notificationQueue.add("send-maturity-reminder", data, {
    attempts,
    backoff: { type: "fixed", delay: 1 },
  });
  if (!job.id) throw new Error("job id missing");

  return waitForFailedJob(notificationQueue, job.id);
}

function notificationJobs() {
  return notificationQueue.getJobs(["waiting", "paused", "delayed"]);
}

describe("worker", () => {
  const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

  function expectSentReminder(userId: Address, maturity: number, window: Window, ttl?: number) {
    const [notification] = sendPushNotification.mock.lastCall ?? [];
    expect(notification).toMatchObject({
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
    });
    expect(notification?.idempotencyKey).toMatch(uuid);
    if (ttl !== undefined) expect(notification?.ttl).toBe(ttl);
  }

  afterAll(() => {
    return Promise.allSettled([queue.close(), notificationQueue.close(), closeQueue(), closeRedis()]).then(
      (results) => {
        const errors = results.flatMap((result) =>
          result.status === "rejected" ? Array.of<unknown>(result.reason) : [],
        );
        if (errors.length > 0) throw new AggregateError(errors, "failed to close maturity test resources");
      },
    );
  });

  beforeEach(async () => {
    await Promise.all([queue.pause(), notificationQueue.pause()]);
    const keys = await redis.keys("notification:*");
    if (keys.length > 0) await redis.del(...keys);
    await Promise.all(["check-debts-24h", "check-debts-1h"].map((id) => queue.removeJobScheduler(id)));
    await Promise.all([queue.obliterate({ force: true }), notificationQueue.obliterate({ force: true })]);
    await database.delete(credentials).where(like(credentials.id, "maturity-test-%"));
    await Promise.all([queue.resume(), notificationQueue.resume()]);
    vi.clearAllMocks();
    sendPushNotification.mockReset();
    sendPushNotification.mockResolvedValue({});
  });

  it("schedules maturity checks", async () => {
    const maturity = nextMaturity();
    vi.spyOn(Date, "now").mockReturnValue((maturity - 25 * 3600) * 1000);
    try {
      await reminders();
      const jobs = await queue.getJobs(["delayed", "waiting"]);
      const scheduler24h = await queue.getJobScheduler("check-debts-24h");
      expect(scheduler24h).toMatchObject({
        key: "check-debts-24h",
        name: "check-debts",
        next: (maturity - 24 * 3600) * 1000,
        every: MATURITY_INTERVAL * 1000,
        offset: schedulerOffset("24h"),
      });
      expect(scheduler24h?.template?.data).toStrictEqual({ window: "24h" });
      const scheduler1h = await queue.getJobScheduler("check-debts-1h");
      expect(scheduler1h).toMatchObject({
        key: "check-debts-1h",
        name: "check-debts",
        next: (maturity - 3600) * 1000,
        every: MATURITY_INTERVAL * 1000,
        offset: schedulerOffset("1h"),
      });
      expect(scheduler1h?.template?.data).toStrictEqual({ window: "1h" });
      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job.data.window).toSorted()).toStrictEqual(["1h", "24h"]);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("enqueues reminder job with debt in single market", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await notificationQueue.pause();
    await insertAccounts([account]);
    mockExactly(account, [market([debt(maturity)])]);

    await checkDone("check-debts", { maturity, window });

    expect(mocks.readContract).toHaveBeenCalledWith({
      address: previewerAddress,
      abi: previewerAbi,
      functionName: "exactly",
      args: [account],
    });
    expect(sendPushNotification).not.toHaveBeenCalled();
    const jobs = await notificationJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(reminderJobId({ userId: account, maturity, window }));
    expect(jobs[0]?.name).toBe("send-maturity-reminder");
    expect(jobs[0]?.data).toStrictEqual({ userId: account, maturity, window });
  });

  it("planner skips already delivered notification", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await notificationQueue.pause();
    await insertAccounts([account]);
    await redis.set(
      `notification:sent:${account}:${String(maturity)}:${window}`,
      String(Date.now()),
      "EX",
      31 * 86_400,
    );
    mockExactly(account, [market([debt(maturity)])]);

    await checkDone("check-debts", { maturity, window });

    expect(await notificationJobs()).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("ignores position with principal = 0 and fee = 0", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = maturityFor("24h");

    await notificationQueue.pause();
    await insertAccounts([account]);
    mockExactly(account, [market([debt(maturity, 0n, 0n)])]);

    await checkDone("check-debts", { maturity, window: "24h" });

    expect(await notificationJobs()).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("handles position with principal = 0 and fee > 0", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await notificationQueue.pause();
    await insertAccounts([account]);
    mockExactly(account, [market([debt(maturity, 0n, 2n * USDC)])]);

    await checkDone("check-debts", { maturity, window });

    const jobs = await notificationJobs();
    expect(jobs.map((job) => job.data.userId)).toStrictEqual([account]);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("ignores debt below minimum usd amount", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = maturityFor("24h");

    await notificationQueue.pause();
    await insertAccounts([account]);
    mockExactly(account, [market([debt(maturity, 2n * USDC - 1n)])]);

    await checkDone("check-debts", { maturity, window: "24h" });

    expect(await notificationJobs()).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("detects aggregate debt above minimum usd amount", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await notificationQueue.pause();
    await insertAccounts([account]);
    mockExactly(account, [market([debt(maturity, 1_500_000n)]), market([debt(maturity, 1_500_000n)])]);

    await checkDone("check-debts", { maturity, window });

    const jobs = await notificationJobs();
    expect(jobs.map((job) => job.data.userId)).toStrictEqual([account]);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("prices debt with market decimals", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await notificationQueue.pause();
    await insertAccounts([account]);
    mockExactly(account, [market([debt(maturity, 800_000_000_000_000n)], { decimals: 18, usdPrice: 2500n * WAD })]);

    await checkDone("check-debts", { maturity, window });

    const jobs = await notificationJobs();
    expect(jobs.map((job) => job.data.userId)).toStrictEqual([account]);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("derives maturity for scheduled jobs", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = nextMaturity();
    vi.spyOn(Date, "now").mockReturnValue((maturity - 57 * 60) * 1000);
    try {
      await notificationQueue.pause();
      await insertAccounts([account]);
      mockExactly(account, [market([debt(maturity)])]);

      await checkDone("check-debts", { window: "1h" });

      const jobs = await notificationJobs();
      expect(jobs.map((job) => job.data)).toStrictEqual([{ userId: account, maturity, window: "1h" }]);
      expect(sendPushNotification).not.toHaveBeenCalled();
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it.each<{ seconds: number; window: Window }>([
    { window: "24h", seconds: 24 * 3600 },
    { window: "1h", seconds: 3600 },
  ])("processes planner job at the exact $window scheduler boundary", async ({ seconds, window }) => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = nextMaturity();
    vi.spyOn(Date, "now").mockReturnValue((maturity - seconds) * 1000);
    try {
      await notificationQueue.pause();
      await insertAccounts([account]);
      mockExactly(account, [market([debt(maturity)])]);

      await checkDone("check-debts", { maturity, window });

      const jobs = await notificationJobs();
      expect(jobs.map((job) => job.data.userId)).toStrictEqual([account]);
      expect(sendPushNotification).not.toHaveBeenCalled();
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("retries rpc failures without duplicating reminder jobs", async () => {
    const first = parse(Address, "0x1234567890123456789012345678901234567890");
    const second = parse(Address, "0x1234567890123456789012345678901234567891");
    const window = "24h";
    const maturity = maturityFor(window);

    await notificationQueue.pause();
    await insertAccounts([first, second]);
    let failed = false;
    mocks.readContract.mockImplementation(({ args }: { args: [Address] }) => {
      if (args[0] === first && !failed) {
        failed = true;
        return Promise.reject(new Error("rpc error"));
      }
      return Promise.resolve(args[0] === first || args[0] === second ? [market([debt(maturity)])] : []);
    });

    await checkDone("check-debts", { maturity, window }, 2);

    const jobs = await notificationJobs();
    expect(jobs.map((job) => job.data.userId).toSorted()).toStrictEqual([first, second].toSorted());
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      extra: { account: first, kind: "rpc", maturity, window },
    });
  });

  it("does not duplicate already sent reminders on planner retry", async () => {
    const first = parse(Address, "0x1234567890123456789012345678901234567890");
    const second = parse(Address, "0x1234567890123456789012345678901234567891");
    const window = "24h";
    const maturity = maturityFor(window);

    await notificationQueue.pause();
    await insertAccounts([first, second]);
    await redis.set(`notification:sent:${second}:${String(maturity)}:${window}`, String(Date.now()), "EX", 31 * 86_400);
    mockExactlyMany([
      [first, [market([debt(maturity)])]],
      [second, [market([debt(maturity)])]],
    ]);

    await checkDone("check-debts", { maturity, window });

    const jobs = await notificationJobs();
    expect(jobs.map((job) => job.data.userId)).toStrictEqual([first]);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("processes chunk plus one accounts", async () => {
    const window = "24h";
    const maturity = maturityFor(window);
    const accounts = testAccounts(51);

    await notificationQueue.pause();
    await insertAccounts(accounts);
    mockExactlyMany(accounts.map((account) => [account, [market([debt(maturity)])]]));

    await checkDone("check-debts", { maturity, window });

    const jobs = await notificationJobs();
    expect(jobs.map((job) => job.data.userId).toSorted()).toStrictEqual(accounts.toSorted());
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("stops scanning when the planner window expires between chunks", async () => {
    const window = "1h";
    const now = Math.floor(Date.now() / 1000);
    const maturity = now + 55 * 60;
    const accounts = testAccounts(51);
    const findMany = vi
      .spyOn(database.query.credentials, "findMany")
      .mockResolvedValueOnce(accounts.slice(0, 50).map((account) => ({ account })) as never)
      .mockResolvedValueOnce(accounts.slice(50).map((account) => ({ account })) as never);
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    try {
      await notificationQueue.pause();
      mocks.readContract.mockImplementation(({ args }: { args: [Address] }) => {
        if (args[0] === accounts[49]) vi.mocked(Date.now).mockReturnValue((maturity - 54 * 60) * 1000);
        return Promise.resolve([market([debt(maturity)])]);
      });

      await checkDone("check-debts", { maturity, window });

      const jobs = await notificationJobs();
      expect(mocks.readContract).toHaveBeenCalledTimes(50);
      expect(jobs.map((job) => job.data.userId).toSorted()).toStrictEqual(accounts.slice(0, 50).toSorted());
      expect(mocks.addBreadcrumb).toHaveBeenCalledWith({
        category: "maturity-queue",
        message: "stale job skipped",
        level: "warning",
        data: { maturity, window, now: maturity - 54 * 60, remaining: 54 * 60 },
      });
    } finally {
      findMany.mockRestore();
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("sends reminder and marks notification after push succeeds", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);
    const key = `notification:sent:${account}:${String(maturity)}:${window}`;

    mockExactly(account, [market([debt(maturity)])]);
    sendPushNotification.mockImplementationOnce(async () => {
      await expect(redis.get(key)).resolves.toBeNull();
      return {};
    });

    await reminderDone({ userId: account, maturity, window });

    expectSentReminder(account, maturity, window);
    await expect(redis.get(key)).resolves.not.toBeNull();
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(30 * 86_400);
    expect(ttl).toBeLessThanOrEqual(31 * 86_400);
  });

  it("uses the 1h wording path", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "1h";
    const maturity = maturityFor(window);

    mockExactly(account, [market([debt(maturity)])]);

    await reminderDone({ userId: account, maturity, window });

    expectSentReminder(account, maturity, window);
    await expect(redis.get(`notification:sent:${account}:${String(maturity)}:${window}`)).resolves.not.toBeNull();
  });

  it.each<{ seconds: number; window: Window }>([
    { window: "24h", seconds: 24 * 3600 },
    { window: "1h", seconds: 3600 },
  ])("sends delivery job at the exact $window scheduler boundary", async ({ seconds, window }) => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = nextMaturity();
    vi.spyOn(Date, "now").mockReturnValue((maturity - seconds) * 1000);
    try {
      mockExactly(account, [market([debt(maturity)])]);

      await reminderDone({ userId: account, maturity, window });

      expectSentReminder(account, maturity, window, seconds);
      await expect(redis.get(`notification:sent:${account}:${String(maturity)}:${window}`)).resolves.not.toBeNull();
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("uses deterministic OneSignal UUID idempotency key", async () => {
    const account = parse(Address, "0x270708d968Dc215FdCdDF5cb54b26cb734c7005B");
    const maturity = 1_782_950_400;
    vi.spyOn(Date, "now").mockReturnValue((maturity - 24 * 3600) * 1000);
    try {
      mockExactly(account, [market([debt(maturity)])]);

      await reminderDone({ userId: account, maturity, window: "24h" });

      expect(sendPushNotification.mock.lastCall?.[0]?.idempotencyKey).toBe("1c4b0158-79db-510e-af5e-878426fa12b1");
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("does not send duplicate delivery after notification was marked sent", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await redis.set(
      `notification:sent:${account}:${String(maturity)}:${window}`,
      String(Date.now()),
      "EX",
      31 * 86_400,
    );
    mockExactly(account, [market([debt(maturity)])]);

    await reminderDone({ userId: account, maturity, window });

    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("does not send when debt was repaid before delivery", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    mockExactly(account, [market([])]);

    await reminderDone({ userId: account, maturity, window });

    expect(sendPushNotification).not.toHaveBeenCalled();
    await expect(redis.get(`notification:sent:${account}:${String(maturity)}:${window}`)).resolves.toBeNull();
  });

  it("retries delivery rpc failures without sending notification", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    mocks.readContract.mockRejectedValue(new Error("rpc error"));

    await expectFailedReminder({ userId: account, maturity, window });

    expect(sendPushNotification).not.toHaveBeenCalled();
    await expect(redis.get(`notification:sent:${account}:${String(maturity)}:${window}`)).resolves.toBeNull();
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      extra: { account, kind: "notification-rpc", maturity, window },
    });
  });

  it("skips stale delivery job", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const now = Math.floor(Date.now() / 1000);
    const maturity = now + 6 * 3600;
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    try {
      mockExactly(account, [market([debt(maturity)])]);

      await reminderDone({ userId: account, maturity, window: "24h" });

      expect(mocks.readContract).not.toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
      await expect(redis.keys("notification:sent:*")).resolves.toHaveLength(0);
      expect(mocks.addBreadcrumb).toHaveBeenCalledWith({
        category: "maturity-notifications",
        message: "stale reminder skipped",
        level: "warning",
        data: { maturity, window: "24h", now, remaining: 6 * 3600, userId: account },
      });
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("skips delivery when rpc finishes after the window expires", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const now = Math.floor(Date.now() / 1000);
    const maturity = now + 55 * 60;
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    try {
      mocks.readContract.mockImplementationOnce(() => {
        vi.mocked(Date.now).mockReturnValue((maturity - 54 * 60) * 1000);
        return Promise.resolve([market([debt(maturity)])]);
      });

      await reminderDone({ userId: account, maturity, window: "1h" });

      expect(sendPushNotification).not.toHaveBeenCalled();
      await expect(redis.get(`notification:sent:${account}:${String(maturity)}:1h`)).resolves.toBeNull();
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("fails when notification delivery fails", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    mockExactly(account, [market([debt(maturity)])]);
    sendPushNotification.mockRejectedValueOnce(new Error("onesignal error"));

    await expectFailedReminder({ userId: account, maturity, window });

    expect(sendPushNotification).toHaveBeenCalledOnce();
    await expect(redis.get(`notification:sent:${account}:${String(maturity)}:${window}`)).resolves.toBeNull();
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      extra: { account, kind: "notification", maturity, window },
    });
  });

  it("retries with same idempotency key when sent marker write fails after push", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);
    const key = `notification:sent:${account}:${String(maturity)}:${window}`;
    const set = queueRedis.set.bind(queueRedis);

    mockExactly(account, [market([debt(maturity)])]);
    vi.spyOn(queueRedis, "set").mockImplementationOnce((...args) => {
      if (args[0] === key) return Promise.reject(new Error("redis error"));
      return set(...args);
    });

    await reminderDone({ userId: account, maturity, window }, 2);

    const idempotencyKeys = sendPushNotification.mock.calls.map(([notification]) => notification.idempotencyKey);
    expect(sendPushNotification).toHaveBeenCalledTimes(2);
    expect(idempotencyKeys[0]).toMatch(uuid);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    await expect(redis.get(key)).resolves.not.toBeNull();
  });

  it("removes failed delivery jobs so catch-up can enqueue the reminder again", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);
    const data: SendReminder = { userId: account, maturity, window };

    await notificationQueue.pause();
    await insertAccounts([account]);
    mockExactly(account, [market([debt(maturity)])]);

    await checkDone("check-debts", { maturity, window });
    await expect(notificationQueue.getJob(reminderJobId(data))).resolves.not.toBeUndefined();
    mocks.readContract.mockRejectedValue(new Error("rpc error"));
    await notificationQueue.resume();
    await vi.waitUntil(() => notificationQueue.getJob(reminderJobId(data)).then((job) => job === undefined), 5000);
    await notificationQueue.pause();

    const duplicate = await notificationQueue.add("send-maturity-reminder", data, {
      jobId: reminderJobId(data),
    });

    expect(duplicate.id).toBe(reminderJobId(data));
    await expect(notificationQueue.getJobs(["waiting", "paused"])).resolves.toHaveLength(1);
  });

  it("schedules the next 24h window when the current one already passed", async () => {
    const maturity = nextMaturity();
    vi.spyOn(Date, "now").mockReturnValue((maturity - 2 * 3600) * 1000);
    try {
      await reminders();
      const scheduler24h = await queue.getJobScheduler("check-debts-24h");
      expect(scheduler24h).toMatchObject({
        next: (maturity + MATURITY_INTERVAL - 24 * 3600) * 1000,
        every: MATURITY_INTERVAL * 1000,
        offset: schedulerOffset("24h"),
      });
      expect(scheduler24h?.template?.data).toStrictEqual({ window: "24h" });
      const scheduler1h = await queue.getJobScheduler("check-debts-1h");
      expect(scheduler1h).toMatchObject({
        next: (maturity - 3600) * 1000,
        every: MATURITY_INTERVAL * 1000,
        offset: schedulerOffset("1h"),
      });
      expect(scheduler1h?.template?.data).toStrictEqual({ window: "1h" });
      const jobs = await queue.getJobs(["delayed", "waiting"]);
      expect(jobs.map((job) => job.data.window).toSorted()).toStrictEqual(["1h", "24h"]);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it.each<{ seconds: number; window: Window }>([
    { window: "24h", seconds: 24 * 3600 },
    { window: "1h", seconds: 3600 },
  ])("adds catch-up at the exact $window scheduler boundary", async ({ seconds, window }) => {
    const maturity = nextMaturity();
    vi.spyOn(Date, "now").mockReturnValue((maturity - seconds) * 1000);
    try {
      const jobs = await reminders();

      expect(jobs.map((job) => job.id)).toContain(catchUpJobId(maturity, window));
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it.each<{ remaining: number; scheduledBefore: number; window: Window }>([
    { window: "24h", scheduledBefore: 25 * 3600, remaining: 23 * 3600 + 30 * 60 },
    { window: "1h", scheduledBefore: 2 * 3600, remaining: 57 * 60 },
  ])(
    "adds catch-up inside the $window window when the scheduler already exists",
    async ({ scheduledBefore, remaining, window }) => {
      const maturity = nextMaturity();
      await queue.pause();
      vi.spyOn(Date, "now").mockReturnValue((maturity - scheduledBefore) * 1000);
      try {
        await reminders();
        vi.mocked(Date.now).mockReturnValue((maturity - remaining) * 1000);

        await reminders();

        await expect(queue.getJob(catchUpJobId(maturity, window))).resolves.not.toBeUndefined();
      } finally {
        vi.mocked(Date.now).mockRestore();
        await queue.resume();
      }
    },
  );

  it("admits one catch-up job across concurrent startups", async () => {
    const maturity = nextMaturity();
    await queue.pause();
    vi.spyOn(Date, "now").mockReturnValue((maturity - 57 * 60) * 1000);
    try {
      await Promise.all([reminders(), reminders()]);

      const jobs = await queue.getJobs(["waiting", "paused", "delayed"]);
      expect(jobs.filter((job) => job.id === catchUpJobId(maturity, "1h"))).toHaveLength(1);
    } finally {
      vi.mocked(Date.now).mockRestore();
      await queue.resume();
    }
  });

  it("configures catch-up retention and recreates removed catch-up", async () => {
    const maturity = nextMaturity();
    const window = "1h";
    await queue.pause();
    vi.spyOn(Date, "now").mockReturnValue((maturity - 57 * 60) * 1000);
    try {
      await reminders();
      const catchUp = await queue.getJob(catchUpJobId(maturity, window));
      expect(catchUp?.opts.removeOnComplete).toStrictEqual({ age: 2 * 3600 });
      expect(catchUp?.opts.removeOnFail).toBe(true);
      await queue.remove(catchUpJobId(maturity, window));

      await reminders();

      await expect(queue.getJob(catchUpJobId(maturity, window))).resolves.not.toBeUndefined();
    } finally {
      vi.mocked(Date.now).mockRestore();
      await queue.resume();
    }
  });

  it("keeps scheduling when startup is inside the final hour", async () => {
    const maturity = nextMaturity();
    vi.spyOn(Date, "now").mockReturnValue((maturity - 30 * 60) * 1000);
    try {
      await reminders();
      const scheduler24h = await queue.getJobScheduler("check-debts-24h");
      expect(scheduler24h).toMatchObject({
        next: (maturity + MATURITY_INTERVAL - 24 * 3600) * 1000,
        every: MATURITY_INTERVAL * 1000,
        offset: schedulerOffset("24h"),
      });
      expect(scheduler24h?.template?.data).toStrictEqual({ window: "24h" });
      const scheduler1h = await queue.getJobScheduler("check-debts-1h");
      expect(scheduler1h).toMatchObject({
        next: (maturity + MATURITY_INTERVAL - 3600) * 1000,
        every: MATURITY_INTERVAL * 1000,
        offset: schedulerOffset("1h"),
      });
      expect(scheduler1h?.template?.data).toStrictEqual({ window: "1h" });
      const jobs = await queue.getJobs(["delayed", "waiting"]);
      expect(jobs.map((job) => job.data.window).toSorted()).toStrictEqual(["1h", "24h"]);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("skips stale planner job when maturity is in the past", async () => {
    await checkDone("check-debts", { maturity: Math.floor(Date.now() / 1000) - 3600, window: "24h" });

    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("skips delayed 24h planner jobs", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const now = Math.floor(Date.now() / 1000);
    const maturity = now + 6 * 3600;
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    try {
      await notificationQueue.pause();
      await insertAccounts([account]);
      mockExactly(account, [market([debt(maturity)])]);

      await checkDone("check-debts", { maturity, window: "24h" });

      expect(await notificationJobs()).toHaveLength(0);
      expect(sendPushNotification).not.toHaveBeenCalled();
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
