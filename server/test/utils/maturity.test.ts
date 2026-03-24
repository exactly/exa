import "../mocks/onesignal";
import "../mocks/sentry";

import { Queue, type Job } from "bullmq";
import { like } from "drizzle-orm";
import { parse } from "valibot";
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, multicall3Abi } from "viem";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import chain, { marketAbi, marketUSDCAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL } from "@exactly/lib";

import database, { credentials } from "../../database";
import { closeQueue, reminders } from "../../utils/maturity";
import * as onesignal from "../../utils/onesignal";
import { close as closeRedis, queue as queueRedis } from "../../utils/redis";

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
type CheckDebts = { window: Window };
type ScanChunk = { accounts: Address[]; chunkIndex: number; maturity: number; window: Window };
type SendReminder = { maturity: number; userId: Address; window: Window };
type Position = readonly [bigint, bigint];
type AggregateCall = { allowFailure: boolean; callData: `0x${string}`; target: Address };

const queue = new Queue<CheckDebts | ScanChunk>("maturity", { connection: queueRedis });
const notificationQueue = new Queue<{ accounts: Address[]; maturity: number; window: Window }>(
  "maturity-notifications",
  { connection: queueRedis },
);
const USDC = 1_000_000n;

function insertAccounts(accounts: Address[]) {
  return database.insert(credentials).values(accounts.map((account, index) => credential(account, index)));
}

function storedAccounts() {
  return database.query.credentials
    .findMany({ columns: { account: true }, orderBy: credentials.account })
    .then((rows) => rows.map(({ account }) => parse(Address, account)));
}

function credential(account: Address, index: number) {
  return {
    id: `maturity-test-${index}`,
    publicKey: new Uint8Array(),
    factory: account,
    account,
    transports: null,
    kycId: null,
    pandaId: null,
    bridgeId: null,
    source: null,
  };
}

function mockFixedBorrowPositions(account: Address, position: Position) {
  mockFixedBorrowPositionsMany([[account, position]]);
}

function mockFixedBorrowPositionsMany(entries: [Address, Position][]) {
  mocks.readContract.mockImplementation(({ args }: { args: readonly [readonly AggregateCall[]] }) =>
    Promise.resolve(
      args[0].map(({ callData }) => {
        const callArguments = decodeFunctionData({ abi: marketAbi, data: callData }).args;
        const position = new Map(entries).get(parse(Address, callArguments[1]));
        return {
          success: true,
          returnData: encodeFunctionResult({
            abi: marketAbi,
            functionName: "fixedBorrowPositions",
            result: position ?? [0n, 0n],
          }),
        };
      }),
    ),
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

function reminderJobId({ maturity, userId, window }: SendReminder) {
  return `maturity-reminder-${userId}-${maturity}-${window}`;
}

function reminderChunkJobId(maturity: number, window: Window, chunkIndex: number) {
  return `maturity-reminders-${maturity}-${window}-${chunkIndex}`;
}

function scanJobId(maturity: number, window: Window, index: number) {
  return `maturity-scan-${maturity}-${window}-${index}`;
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

async function checkDone(name: string, data: CheckDebts, attempts = 1, delay = 1, wait = true) {
  const job = await queue.add(name, data, { attempts, backoff: { type: "fixed", delay } });
  if (!job.id) throw new Error("job id missing");

  const result = await waitForCompletedJob(queue, job.id);
  if (wait && name === "check-debts") await waitForScanJobs(nextMaturity(), data.window);
  return result;
}

async function checkDoneAt(name: string, maturity: number, window: Window, attempts = 1, delay = 1) {
  vi.spyOn(Date, "now").mockReturnValue((maturity - (window === "24h" ? 23 * 3600 + 30 * 60 : 57 * 60)) * 1000);
  let result: Awaited<ReturnType<typeof checkDone>>;
  try {
    result = await checkDone(name, { window }, attempts, delay, false);
    if (name === "check-debts") {
      await waitForScanJobs(maturity, window);
      if (!(await notificationQueue.isPaused()))
        await vi.waitUntil(
          () =>
            notificationJobs().then((jobs) =>
              jobs.every((job) => job.data.maturity !== maturity || job.data.window !== window),
            ),
          10_000,
        );
    }
  } finally {
    vi.mocked(Date.now).mockRestore();
  }
  return result;
}

async function addReminder(data: SendReminder, attempts = 1) {
  const job = await notificationQueue.add(
    "send-maturity-reminders",
    { accounts: [data.userId], maturity: data.maturity, window: data.window },
    {
      jobId: reminderJobId(data),
      attempts,
      backoff: { type: "fixed", delay: 1 },
    },
  );
  if (!job.id) throw new Error("job id missing");
  return job.id;
}

async function reminderDone(data: SendReminder, attempts = 1) {
  return waitForCompletedJob(notificationQueue, await addReminder(data, attempts));
}

async function expectFailedReminder(data: SendReminder, attempts = 1) {
  return waitForFailedJob(notificationQueue, await addReminder(data, attempts));
}

function notificationJobs() {
  return notificationQueue.getJobs(["waiting", "active", "paused", "delayed"]);
}

function scanJobs() {
  return queue.getJobs(["waiting", "active", "paused", "delayed", "completed", "failed"]);
}

function isScanJob(job: Job<CheckDebts | ScanChunk>): job is Job<ScanChunk> {
  return job.name === "scan-chunk";
}

async function waitForScanJobs(maturity: number, window: Window) {
  await vi.waitUntil(
    () =>
      scanJobs().then((jobs) =>
        Promise.all(
          jobs
            .filter(isScanJob)
            .filter((job) => job.data.maturity === maturity && job.data.window === window)
            .map((job) => job.getState()),
        ).then((states) =>
          states.every(
            (state) => !["waiting", "active", "paused", "delayed", "prioritized", "waiting-children"].includes(state),
          ),
        ),
      ),
    10_000,
  );
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
    expect(notification?.idempotencyKey).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u);
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
      const scheduler24h = await queue.getJobScheduler("check-debts-24h");
      expect(scheduler24h).toMatchObject({
        key: "check-debts-24h",
        name: "check-debts",
        every: MATURITY_INTERVAL * 1000,
      });
      expect(scheduler24h?.template?.data).toStrictEqual({ window: "24h" });
      const scheduler1h = await queue.getJobScheduler("check-debts-1h");
      expect(scheduler1h).toMatchObject({
        key: "check-debts-1h",
        name: "check-debts",
        every: MATURITY_INTERVAL * 1000,
      });
      expect(scheduler1h?.template?.data).toStrictEqual({ window: "1h" });
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("enqueues reminder job with debt in single market", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = nextMaturity();

    await notificationQueue.pause();
    await insertAccounts([account]);
    mockFixedBorrowPositions(account, [100n * USDC, 0n]);

    await checkDoneAt("check-debts", maturity, window);

    expect(mocks.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: chain.contracts.multicall3.address,
        abi: multicall3Abi,
        functionName: "aggregate3",
        args: [
          expect.arrayContaining([
            {
              target: marketUSDCAddress,
              allowFailure: true,
              callData: encodeFunctionData({
                abi: marketAbi,
                functionName: "fixedBorrowPositions",
                args: [BigInt(maturity), account],
              }),
            },
          ]),
        ],
      }),
    );
    expect(sendPushNotification).not.toHaveBeenCalled();
    const jobs = await notificationJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe(reminderChunkJobId(maturity, window, 0));
    expect(jobs[0]?.name).toBe("send-maturity-reminders");
    expect(jobs[0]?.data).toStrictEqual({ accounts: [account], maturity, window });
  });

  it("retains completed reminder jobs so the planner does not enqueue duplicates", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = nextMaturity();

    await insertAccounts([account]);
    mockFixedBorrowPositions(account, [100n * USDC, 0n]);

    await checkDoneAt("check-debts", maturity, window);
    await vi.waitUntil(() => sendPushNotification.mock.calls.length === 1, 5000);
    const completed = await notificationQueue.getJob(reminderChunkJobId(maturity, window, 0));
    expect(await completed?.getState()).toBe("completed");
    expect(completed?.opts.removeOnComplete).toStrictEqual({ age: 31 * 86_400, count: 100_000 });
    await notificationQueue.pause();
    sendPushNotification.mockClear();
    await checkDoneAt("check-debts", maturity, window);

    expect(await notificationJobs()).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("ignores position with principal = 0 and fee = 0", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = nextMaturity();

    await notificationQueue.pause();
    await insertAccounts([account]);
    mockFixedBorrowPositions(account, [0n, 0n]);

    await checkDoneAt("check-debts", maturity, "24h");

    expect(await notificationJobs()).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("handles position with principal = 0 and fee > 0", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = nextMaturity();

    await notificationQueue.pause();
    await insertAccounts([account]);
    mockFixedBorrowPositions(account, [0n, 2n * USDC]);

    await checkDoneAt("check-debts", maturity, window);

    const jobs = await notificationJobs();
    expect(jobs.flatMap((job) => job.data.accounts)).toStrictEqual([account]);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("ignores debt below minimum usd amount", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = nextMaturity();

    await notificationQueue.pause();
    await insertAccounts([account]);
    mockFixedBorrowPositions(account, [2n * USDC - 1n, 0n]);

    await checkDoneAt("check-debts", maturity, "24h");

    expect(await notificationJobs()).toHaveLength(0);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("derives maturity for scheduled jobs", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = nextMaturity();
    vi.spyOn(Date, "now").mockReturnValue((maturity - 57 * 60) * 1000);
    try {
      await notificationQueue.pause();
      await insertAccounts([account]);
      mockFixedBorrowPositions(account, [100n * USDC, 0n]);

      await checkDone("check-debts", { window: "1h" });

      const jobs = await notificationJobs();
      expect(jobs.map((job) => job.data)).toStrictEqual([{ accounts: [account], maturity, window: "1h" }]);
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
      mockFixedBorrowPositions(account, [100n * USDC, 0n]);

      await checkDone("check-debts", { window });

      const jobs = await notificationJobs();
      expect(jobs.flatMap((job) => job.data.accounts)).toStrictEqual([account]);
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
    let failed = false;
    mocks.readContract.mockImplementation(({ args }: { args: readonly [readonly AggregateCall[]] }) =>
      Promise.resolve(
        args[0].map(({ callData }) => {
          const callArguments = decodeFunctionData({ abi: marketAbi, data: callData }).args;
          if (parse(Address, callArguments[1]) === first && !failed) {
            failed = true;
            return { success: false, returnData: "0x" as const };
          }
          return {
            success: true,
            returnData: encodeFunctionResult({
              abi: marketAbi,
              functionName: "fixedBorrowPositions",
              result: [100n * USDC, 0n],
            }),
          };
        }),
      ),
    );

    const job = await queue.add(
      "scan-chunk",
      { accounts: [first, second], chunkIndex: 0, maturity, window },
      { attempts: 2, backoff: { type: "fixed", delay: 0 } },
    );
    if (!job.id) throw new Error("job id missing");
    await waitForCompletedJob(queue, job.id);

    const jobs = await notificationJobs();
    expect(jobs.flatMap((reminder) => reminder.data.accounts).toSorted()).toStrictEqual([first, second].toSorted());
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      extra: { accounts: 2, kind: "rpc", maturity, window },
    });
  });

  it("does not duplicate queued reminders on planner retry", async () => {
    const first = parse(Address, "0x1234567890123456789012345678901234567890");
    const second = parse(Address, "0x1234567890123456789012345678901234567891");
    const window = "24h";
    const maturity = nextMaturity();

    await notificationQueue.pause();
    await insertAccounts([first, second]);
    mockFixedBorrowPositionsMany([
      [first, [100n * USDC, 0n]],
      [second, [100n * USDC, 0n]],
    ]);

    await checkDoneAt("check-debts", maturity, window);
    await checkDoneAt("check-debts", maturity, window);

    const jobs = await notificationJobs();
    expect(jobs.flatMap((job) => job.data.accounts).toSorted()).toStrictEqual([first, second].toSorted());
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("processes two scan chunks of 768 accounts", async () => {
    const window = "24h";
    const maturity = nextMaturity();
    const accounts = testAccounts(769);

    await notificationQueue.pause();
    await insertAccounts(accounts);
    const snapshot = await storedAccounts();
    mockFixedBorrowPositionsMany(accounts.map((account) => [account, [100n * USDC, 0n]]));

    await checkDoneAt("check-debts", maturity, window);

    const jobs = await notificationJobs();
    expect(jobs.flatMap((job) => job.data.accounts).toSorted()).toStrictEqual(accounts.toSorted());
    const scans = await scanJobs();
    expect(
      scans.filter((job) => isScanJob(job) && job.data.maturity === maturity && job.data.window === window),
    ).toHaveLength(Math.ceil(snapshot.length / 768));
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("coordinates scan chunks with deterministic payloads", async () => {
    const window = "24h";
    const maturity = nextMaturity();
    const accounts = testAccounts(51);

    await notificationQueue.pause();
    await insertAccounts(accounts);
    const snapshot = await storedAccounts();
    mockFixedBorrowPositionsMany(accounts.map((account) => [account, [100n * USDC, 0n]]));

    await checkDoneAt("check-debts", maturity, window);
    await waitForScanJobs(maturity, window);
    const extra = parse(Address, "0x9999999999999999999999999999999999999999");
    await database.insert(credentials).values(credential(extra, 999));

    const scans = await scanJobs();
    const jobs = scans
      .filter(isScanJob)
      .filter((job) => job.data.maturity === maturity && job.data.window === window)
      .toSorted((first, second) => String(first.id).localeCompare(String(second.id)));
    const chunks = [snapshot];
    expect(jobs.map((job) => job.id)).toStrictEqual(chunks.map((_, index) => scanJobId(maturity, window, index)));
    expect(jobs.map((job) => job.data.accounts)).toStrictEqual(chunks);
    expect(jobs.flatMap((job) => job.data.accounts)).not.toContain(extra);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("completes the coordinator while chunk rpc work is pending", async () => {
    const account = testAccounts(1)[0];
    if (!account) throw new Error("account missing");
    const window = "24h";
    const maturity = nextMaturity();
    let resolveRead!: (position: Position) => void;
    const read = new Promise<Position>((resolve) => {
      resolveRead = resolve;
    });
    vi.spyOn(Date, "now").mockReturnValue((maturity - 23 * 3600 - 30 * 60) * 1000);
    try {
      await insertAccounts([account]);
      await notificationQueue.pause();
      mocks.readContract.mockReturnValue(
        read.then((result) => [
          {
            success: true,
            returnData: encodeFunctionResult({
              abi: marketAbi,
              functionName: "fixedBorrowPositions",
              result,
            }),
          },
        ]),
      );
      const coordinator = await queue.add("check-debts", { window }, { attempts: 1 });
      if (!coordinator.id) throw new Error("job id missing");
      await waitForCompletedJob(queue, coordinator.id);
      await vi.waitUntil(() => mocks.readContract.mock.calls.length === 1, 5000);
      expect(mocks.readContract).toHaveBeenCalledTimes(1);
      vi.mocked(Date.now).mockRestore();
      resolveRead([100n * USDC, 0n]);
      await waitForScanJobs(maturity, window);
    } finally {
      resolveRead([0n, 0n]);
      if (vi.isMockFunction(Date.now)) vi.mocked(Date.now).mockRestore();
    }
  });

  it("limits concurrent scan chunks to three", async () => {
    const accounts = testAccounts(4);
    const window = "24h";
    const maturity = maturityFor(window);
    let active = 0;
    let maximum = 0;

    await notificationQueue.pause();
    mocks.readContract.mockImplementation(
      ({ args }: { args: readonly [readonly AggregateCall[]] }) =>
        new Promise((resolve) => {
          active += 1;
          maximum = Math.max(maximum, active);
          setTimeout(() => {
            active -= 1;
            resolve(
              args[0].map(() => ({
                success: true,
                returnData: encodeFunctionResult({
                  abi: marketAbi,
                  functionName: "fixedBorrowPositions",
                  result: [0n, 0n],
                }),
              })),
            );
          }, 25);
        }),
    );
    const jobs = await queue.addBulk(
      accounts.map((account, index) => ({
        name: "scan-chunk",
        data: { accounts: [account], chunkIndex: index, maturity, window },
        opts: { jobId: scanJobId(maturity, window, index), attempts: 1 },
      })),
    );
    await Promise.all(
      jobs.map((job) => {
        if (!job.id) throw new Error("job id missing");
        return waitForCompletedJob(queue, job.id);
      }),
    );

    expect(maximum).toBeLessThanOrEqual(3);
  });

  it("does not duplicate scan chunks when the coordinator retries", async () => {
    const window = "24h";
    const maturity = nextMaturity();
    const accounts = testAccounts(51);

    await notificationQueue.pause();
    await insertAccounts(accounts);
    const snapshot = await storedAccounts();
    mockFixedBorrowPositionsMany(accounts.map((account) => [account, [100n * USDC, 0n]]));

    await checkDoneAt("check-debts", maturity, window);
    await checkDoneAt("check-debts", maturity, window);
    await waitForScanJobs(maturity, window);

    const scans = await scanJobs();
    const jobs = scans.filter((job) => isScanJob(job) && job.data.maturity === maturity && job.data.window === window);
    expect(jobs.map((job) => job.id).toSorted()).toStrictEqual(
      Array.from({ length: Math.ceil(snapshot.length / 768) }, (_, index) => scanJobId(maturity, window, index)),
    );
  });

  it("skips stale scan chunks before reading accounts", async () => {
    const window = "1h";
    const maturity = nextMaturity();
    const now = maturity - 54 * 60;
    const accounts = testAccounts(51);
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    try {
      await notificationQueue.pause();
      const job = await queue.add("scan-chunk", { accounts, chunkIndex: 0, maturity, window }, { attempts: 1 });
      if (!job.id) throw new Error("job id missing");
      await waitForCompletedJob(queue, job.id);

      const jobs = await notificationJobs();
      expect(mocks.readContract).not.toHaveBeenCalled();
      expect(jobs).toHaveLength(0);
      expect(mocks.addBreadcrumb).toHaveBeenCalledWith({
        category: "maturity-queue",
        message: "stale scan chunk skipped",
        level: "warning",
        data: { maturity, window, now: maturity - 54 * 60, remaining: 54 * 60 },
      });
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("sends reminder and keeps the completed job as the delivery marker", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);
    const data: SendReminder = { userId: account, maturity, window };

    await reminderDone(data);

    expectSentReminder(account, maturity, window);
    const completed = await notificationQueue.getJob(reminderJobId(data));
    expect(await completed?.getState()).toBe("completed");
  });

  it("sends a delivery chunk without an on-chain recheck", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    await reminderDone({ userId: account, maturity, window });

    expect(mocks.readContract).not.toHaveBeenCalled();
    expect(sendPushNotification).toHaveBeenCalledOnce();
    expect(sendPushNotification.mock.calls[0]?.[0]?.userId).toBe(account);
  });

  it("uses the 1h wording path", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "1h";
    const maturity = maturityFor(window);

    await reminderDone({ userId: account, maturity, window });

    expect(sendPushNotification).toHaveBeenCalledOnce();
    expectSentReminder(account, maturity, window);
  });

  it.each<{ seconds: number; window: Window }>([
    { window: "24h", seconds: 24 * 3600 },
    { window: "1h", seconds: 3600 },
  ])("sends delivery job at the exact $window scheduler boundary", async ({ seconds, window }) => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = nextMaturity();
    vi.spyOn(Date, "now").mockReturnValue((maturity - seconds) * 1000);
    try {
      await reminderDone({ userId: account, maturity, window });

      expect(sendPushNotification).toHaveBeenCalledOnce();
      expectSentReminder(account, maturity, window, seconds);
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("uses deterministic OneSignal UUID idempotency key", async () => {
    const account = parse(Address, "0x270708d968Dc215FdCdDF5cb54b26cb734c7005B");
    const maturity = 1_782_950_400;
    vi.spyOn(Date, "now").mockReturnValue((maturity - 24 * 3600) * 1000);
    try {
      await reminderDone({ userId: account, maturity, window: "24h" });

      expect(sendPushNotification.mock.lastCall?.[0]?.idempotencyKey).toBe("1c4b0158-79db-510e-af5e-878426fa12b1");
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("does not send duplicate delivery when the reminder job already completed", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);
    const data: SendReminder = { userId: account, maturity, window };

    await reminderDone(data);
    sendPushNotification.mockClear();
    const duplicate = await notificationQueue.add(
      "send-maturity-reminders",
      { accounts: [account], maturity, window },
      { jobId: reminderJobId(data) },
    );

    expect(await duplicate.getState()).toBe("completed");
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("skips stale delivery job", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const now = Math.floor(Date.now() / 1000);
    const maturity = now + 6 * 3600;
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    try {
      await reminderDone({ userId: account, maturity, window: "24h" });

      expect(mocks.readContract).not.toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
      expect(mocks.addBreadcrumb).toHaveBeenCalledWith({
        category: "maturity-notifications",
        message: "stale reminder skipped",
        level: "warning",
        data: { maturity, window: "24h", now, remaining: 6 * 3600, accounts: 1 },
      });
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("fails when notification delivery fails", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    sendPushNotification.mockRejectedValueOnce(new Error("onesignal error"));

    await expectFailedReminder({ userId: account, maturity, window });

    expect(sendPushNotification).toHaveBeenCalledOnce();
    expect(mocks.captureException).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      extra: { account, kind: "notification", maturity, window },
    });
  });

  it("retries with same idempotency key after notification delivery fails", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);

    sendPushNotification.mockRejectedValueOnce(new Error("onesignal error")).mockResolvedValueOnce({});

    await reminderDone({ userId: account, maturity, window }, 2);

    const idempotencyKeys = sendPushNotification.mock.calls.map(([notification]) => notification.idempotencyKey);
    expect(sendPushNotification).toHaveBeenCalledTimes(2);
    expect(idempotencyKeys[0]).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/u);
    expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
  });

  it("retries only failed deliveries without changing idempotency keys", async () => {
    const first = parse(Address, "0x1234567890123456789012345678901234567890");
    const second = parse(Address, "0x1234567890123456789012345678901234567891");
    const window = "24h";
    const maturity = maturityFor(window);
    sendPushNotification
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("onesignal error"))
      .mockResolvedValue({});

    const job = await notificationQueue.add(
      "send-maturity-reminders",
      { accounts: [first, second], maturity, window },
      { jobId: `maturity-reminders-${maturity}-${window}-0`, attempts: 2, backoff: { type: "fixed", delay: 0 } },
    );
    if (!job.id) throw new Error("job id missing");
    await waitForCompletedJob(notificationQueue, job.id);

    const firstKeys = sendPushNotification.mock.calls
      .filter(([notification]) => notification.userId === first)
      .map(([notification]) => notification.idempotencyKey);
    const secondKeys = sendPushNotification.mock.calls
      .filter(([notification]) => notification.userId === second)
      .map(([notification]) => notification.idempotencyKey);
    expect(sendPushNotification).toHaveBeenCalledTimes(3);
    expect(firstKeys).toHaveLength(1);
    expect(secondKeys).toHaveLength(2);
    expect(secondKeys[0]).toBe(secondKeys[1]);
  });

  it("retains failed delivery jobs for forensics and blocks duplicate job id admission", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const window = "24h";
    const maturity = maturityFor(window);
    const data: SendReminder = { userId: account, maturity, window };

    await notificationQueue.pause();
    await notificationQueue.add(
      "send-maturity-reminders",
      { accounts: [account], maturity, window },
      {
        jobId: reminderJobId(data),
        attempts: 1,
        removeOnFail: { age: 7 * 86_400, count: 10_000 },
      },
    );
    sendPushNotification.mockRejectedValueOnce(new Error("onesignal error"));
    await notificationQueue.resume();
    await vi.waitUntil(
      () => notificationQueue.getJobs(["failed"]).then((jobs) => jobs.some((job) => job.id === reminderJobId(data))),
      5000,
    );
    await notificationQueue.pause();

    const duplicate = await notificationQueue.add(
      "send-maturity-reminders",
      { accounts: [account], maturity, window },
      {
        jobId: reminderJobId(data),
      },
    );

    expect(duplicate.id).toBe(reminderJobId(data));
    const failed = await notificationQueue.getJob(reminderJobId(data));
    expect(await failed?.getState()).toBe("failed");
    expect(failed?.opts.removeOnFail).toStrictEqual({ age: 7 * 86_400, count: 10_000 });
    await expect(notificationQueue.getJobs(["waiting", "paused"])).resolves.toHaveLength(0);
  });

  it("schedules the next 24h window when the current one already passed", async () => {
    const maturity = nextMaturity();
    vi.spyOn(Date, "now").mockReturnValue((maturity - 2 * 3600) * 1000);
    try {
      await reminders();
      const scheduler24h = await queue.getJobScheduler("check-debts-24h");
      expect(scheduler24h).toMatchObject({
        every: MATURITY_INTERVAL * 1000,
      });
      expect(scheduler24h?.template?.data).toStrictEqual({ window: "24h" });
      const scheduler1h = await queue.getJobScheduler("check-debts-1h");
      expect(scheduler1h).toMatchObject({
        every: MATURITY_INTERVAL * 1000,
      });
      expect(scheduler1h?.template?.data).toStrictEqual({ window: "1h" });
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it.each<{ remaining: number; window: Window }>([
    { window: "24h", remaining: 23 * 3600 + 30 * 60 },
    { window: "1h", remaining: 57 * 60 },
  ])("warns inside the $window window without a scheduler", async ({ remaining, window }) => {
    const maturity = nextMaturity();
    const now = maturity - remaining;
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    try {
      const jobs = await reminders();

      expect(jobs).toHaveLength(2);
      expect(jobs.map((job) => job.data.window).toSorted()).toStrictEqual(["1h", "24h"]);
      expect(mocks.addBreadcrumb).toHaveBeenCalledWith({
        category: "maturity-queue",
        message: "scheduler started inside reminder window",
        level: "warning",
        data: { maturity, window, now, remaining },
      });
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it.each<{ remaining: number; scheduledBefore: number; window: Window }>([
    { window: "24h", scheduledBefore: 25 * 3600, remaining: 23 * 3600 + 30 * 60 },
    { window: "1h", scheduledBefore: 2 * 3600, remaining: 57 * 60 },
  ])(
    "does not warn inside the $window window when the scheduler already exists",
    async ({ scheduledBefore, remaining, window }) => {
      const maturity = nextMaturity();
      await queue.pause();
      vi.spyOn(Date, "now").mockReturnValue((maturity - scheduledBefore) * 1000);
      try {
        await reminders();
        mocks.addBreadcrumb.mockClear();
        vi.mocked(Date.now).mockReturnValue((maturity - remaining) * 1000);

        await reminders();

        expect(mocks.addBreadcrumb).not.toHaveBeenCalled();
      } finally {
        vi.mocked(Date.now).mockRestore();
        await queue.resume();
      }
    },
  );

  it("keeps scheduling when startup is inside the final hour", async () => {
    const maturity = nextMaturity();
    vi.spyOn(Date, "now").mockReturnValue((maturity - 30 * 60) * 1000);
    try {
      await reminders();
      const scheduler24h = await queue.getJobScheduler("check-debts-24h");
      expect(scheduler24h).toMatchObject({
        every: MATURITY_INTERVAL * 1000,
      });
      expect(scheduler24h?.template?.data).toStrictEqual({ window: "24h" });
      const scheduler1h = await queue.getJobScheduler("check-debts-1h");
      expect(scheduler1h).toMatchObject({
        every: MATURITY_INTERVAL * 1000,
      });
      expect(scheduler1h?.template?.data).toStrictEqual({ window: "1h" });
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it("skips delayed 24h planner jobs", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567890");
    const maturity = nextMaturity();
    const now = maturity - 6 * 3600;
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    try {
      await notificationQueue.pause();
      await insertAccounts([account]);
      mockFixedBorrowPositions(account, [100n * USDC, 0n]);

      await checkDone("check-debts", { window: "24h" });

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
