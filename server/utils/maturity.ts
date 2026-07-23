import { SPAN_STATUS_ERROR } from "@sentry/core";
import { addBreadcrumb, captureException, startSpan } from "@sentry/node";
import { Queue, Worker } from "bullmq";
import { v5 } from "uuid";
import { array, number, object, parse, picklist, type InferOutput } from "valibot";
import { decodeFunctionResult, encodeFunctionData, multicall3Abi } from "viem";

import chain, { marketAbi, marketUSDCAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL } from "@exactly/lib";

import { sendPushNotification } from "./onesignal";
import publicClient from "./publicClient";
import { queue as connection } from "./redis";
import database, { credentials } from "../database";
import t from "../i18n";

const queueName = "maturity";
const notificationQueueName = "maturity-notifications";
const chunkSize = 768;
const windowSchema = picklist(["1h", "24h"]);

const checkDebtsSchema = object({ window: windowSchema });
const scanChunkSchema = object({
  accounts: array(Address),
  chunkIndex: number(),
  maturity: number(),
  window: windowSchema,
});
const sendMaturityRemindersSchema = object({
  accounts: array(Address),
  maturity: number(),
  window: windowSchema,
});

type CheckDebts = InferOutput<typeof checkDebtsSchema>;
type ScanChunk = InferOutput<typeof scanChunkSchema>;
type SendMaturityReminders = InferOutput<typeof sendMaturityRemindersSchema>;

const queue = new Queue<CheckDebts | ScanChunk>(queueName, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 31 * 86_400, count: 100_000 },
    removeOnFail: { age: 7 * 86_400, count: 10_000 },
  },
});

const notificationQueue = new Queue<SendMaturityReminders>(notificationQueueName, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { age: 31 * 86_400, count: 100_000 },
    removeOnFail: { age: 7 * 86_400, count: 10_000 },
  },
});

const worker = observe(
  new Worker<CheckDebts | ScanChunk>(
    queueName,
    (job) =>
      startSpan(
        { name: "maturity.processor", op: "queue.process", attributes: { job: job.name, ...job.data } },
        async (span) => {
          switch (job.name) {
            case "check-debts": {
              const check = parse(checkDebtsSchema, job.data);
              const maturity = (Math.floor(Date.now() / 1000 / MATURITY_INTERVAL) + 1) * MATURITY_INTERVAL;
              const now = Math.floor(Date.now() / 1000);
              const remaining = maturity - now;
              if (!insideWindow(check.window, remaining)) {
                addBreadcrumb({
                  category: "maturity-queue",
                  message: "stale job skipped",
                  level: "warning",
                  data: { maturity, window: check.window, now, remaining },
                });
                break;
              }
              const accounts = await database.query.credentials
                .findMany({
                  columns: { account: true },
                  orderBy: credentials.account,
                })
                .then((rows) => rows.map(({ account }) => parse(Address, account)));
              const jobs = Array.from({ length: Math.ceil(accounts.length / chunkSize) }, (_, index) => ({
                name: "scan-chunk",
                data: {
                  accounts: accounts.slice(index * chunkSize, (index + 1) * chunkSize),
                  chunkIndex: index,
                  maturity,
                  window: check.window,
                },
                opts: { jobId: `maturity-scan-${maturity}-${check.window}-${index}` },
              }));
              if (jobs.length > 0) await queue.addBulk(jobs);
              addBreadcrumb({
                category: "maturity-queue",
                message: "queued scan chunks",
                level: "info",
                data: { accounts: accounts.length, chunks: jobs.length, maturity, window: check.window },
              });
              break;
            }

            case "scan-chunk": {
              const scan = parse(scanChunkSchema, job.data);
              const now = Math.floor(Date.now() / 1000);
              const remaining = scan.maturity - now;
              if (!insideWindow(scan.window, remaining)) {
                addBreadcrumb({
                  category: "maturity-queue",
                  message: "stale scan chunk skipped",
                  level: "warning",
                  data: { maturity: scan.maturity, window: scan.window, now, remaining },
                });
                break;
              }
              let rpcFailures = 0;
              const accounts = await publicClient
                .readContract({
                  address: chain.contracts.multicall3.address,
                  abi: multicall3Abi,
                  functionName: "aggregate3",
                  args: [
                    scan.accounts.map((account) => ({
                      target: marketUSDCAddress,
                      allowFailure: true,
                      callData: encodeFunctionData({
                        abi: marketAbi,
                        functionName: "fixedBorrowPositions",
                        args: [BigInt(scan.maturity), account],
                      }),
                    })),
                  ],
                })
                .then((results) =>
                  scan.accounts.flatMap((userId, index) => {
                    const result = results[index];
                    if (!result?.success) {
                      rpcFailures += 1;
                      return [];
                    }
                    const [principal, fee] = decodeFunctionResult({
                      abi: marketAbi,
                      functionName: "fixedBorrowPositions",
                      data: result.returnData,
                    });
                    return principal + fee >= 2_000_000n ? [userId] : [];
                  }),
                );
              if (rpcFailures > 0) {
                captureException(new Error("fixed borrow position call failed"), {
                  level: "error",
                  extra: { accounts: scan.accounts.length, kind: "rpc", maturity: scan.maturity, window: scan.window },
                });
                throw new Error("rpc failed");
              }
              if (accounts.length > 0)
                await notificationQueue.add(
                  "send-maturity-reminders",
                  {
                    accounts,
                    maturity: scan.maturity,
                    window: scan.window,
                  },
                  { jobId: `maturity-reminders-${scan.maturity}-${scan.window}-${scan.chunkIndex}` },
                );
              addBreadcrumb({
                category: "maturity-queue",
                message: "processed scan chunk",
                level: "info",
                data: { accounts: scan.accounts.length, queuedNotifications: accounts.length, rpcFailures },
              });
              break;
            }

            default: {
              const message = `Unknown job name: ${job.name}`;
              span.setStatus({ code: SPAN_STATUS_ERROR, message });
              throw new Error(message);
            }
          }
        },
      ),
    { connection, concurrency: 3 },
  ),
  queueName,
);

const notificationWorker = observe(
  new Worker<SendMaturityReminders>(
    notificationQueueName,
    (job) =>
      startSpan(
        { name: "maturity-notifications.processor", op: "queue.process", attributes: { job: job.name, ...job.data } },
        async (span) => {
          const reminder = parse(sendMaturityRemindersSchema, job.data);
          switch (job.name) {
            case "send-maturity-reminders": {
              let now = Math.floor(Date.now() / 1000);
              let remaining = reminder.maturity - now;
              if (!insideWindow(reminder.window, remaining)) {
                addBreadcrumb({
                  category: notificationQueueName,
                  message: "stale reminder skipped",
                  level: "warning",
                  data: {
                    maturity: reminder.maturity,
                    window: reminder.window,
                    now,
                    remaining,
                    accounts: reminder.accounts.length,
                  },
                });
                break;
              }
              const failedAccounts: Address[] = [];
              for (let offset = 0; offset < reminder.accounts.length; offset += 50) {
                now = Math.floor(Date.now() / 1000);
                remaining = reminder.maturity - now;
                if (!insideWindow(reminder.window, remaining)) {
                  addBreadcrumb({
                    category: notificationQueueName,
                    message: "stale reminder skipped",
                    level: "warning",
                    data: {
                      maturity: reminder.maturity,
                      window: reminder.window,
                      now,
                      remaining,
                      accounts: reminder.accounts.length,
                    },
                  });
                  break;
                }
                const batch = reminder.accounts.slice(offset, offset + 50);
                const results = await Promise.allSettled(
                  batch.map((userId) =>
                    sendPushNotification({
                      userId,
                      headings: t("Payment due soon"),
                      contents: t(
                        reminder.window === "24h"
                          ? "Your debt is due in 24 hours. Repay now to avoid penalties."
                          : "Your debt is due in 1 hour. Repay now to avoid penalties.",
                      ),
                      idempotencyKey: v5(
                        `https://exact.ly/maturity-reminder/${userId}/${reminder.maturity}/${reminder.window}`,
                        v5.URL,
                      ),
                      ttl: remaining,
                    }),
                  ),
                );
                for (const [index, result] of results.entries()) {
                  if (result.status === "rejected") {
                    const account = batch[index];
                    if (!account) continue;
                    failedAccounts.push(account);
                    captureException(result.reason, {
                      level: "error",
                      extra: { account, kind: "notification", maturity: reminder.maturity, window: reminder.window },
                    });
                  }
                }
              }
              if (failedAccounts.length > 0) {
                await job.updateData({ ...reminder, accounts: failedAccounts });
                throw new Error("notification failed");
              }
              break;
            }

            default: {
              const message = `Unknown job name: ${job.name}`;
              span.setStatus({ code: SPAN_STATUS_ERROR, message });
              throw new Error(message);
            }
          }
        },
      ),
    { connection, concurrency: 1 },
  ),
  notificationQueueName,
);

export function closeQueue() {
  return Promise.allSettled([
    worker.close(),
    notificationWorker.close(),
    queue.close(),
    notificationQueue.close(),
  ]).then((results) => {
    const errors = results.flatMap((result) =>
      result.status === "rejected"
        ? [result.reason instanceof Error ? result.reason : new Error(String(result.reason))]
        : [],
    );
    if (errors.length > 0) throw new AggregateError(errors, "closing maturity queue failed");
  });
}

export async function reminders() {
  await queue.setGlobalConcurrency(3);
  const [scheduled24h, scheduled1h] = await Promise.all([
    queue.getJobScheduler("check-debts-24h"),
    queue.getJobScheduler("check-debts-1h"),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const maturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
  const remaining = maturity - now;
  if (!scheduled24h && remaining >= 23 * 3600 && remaining < 24 * 3600)
    addBreadcrumb({
      category: "maturity-queue",
      message: "scheduler started inside reminder window",
      level: "warning",
      data: { maturity, now, remaining, window: "24h" },
    });
  if (!scheduled1h && remaining >= 55 * 60 && remaining < 3600)
    addBreadcrumb({
      category: "maturity-queue",
      message: "scheduler started inside reminder window",
      level: "warning",
      data: { maturity, now, remaining, window: "1h" },
    });
  return Promise.all([
    queue.upsertJobScheduler(
      "check-debts-24h",
      { every: MATURITY_INTERVAL * 1000, offset: (MATURITY_INTERVAL - 24 * 3600) * 1000 },
      { name: "check-debts", data: { window: "24h" } },
    ),
    queue.upsertJobScheduler(
      "check-debts-1h",
      { every: MATURITY_INTERVAL * 1000, offset: (MATURITY_INTERVAL - 3600) * 1000 },
      { name: "check-debts", data: { window: "1h" } },
    ),
  ]);
}

function observe<T>(target: Worker<T>, name: typeof notificationQueueName | typeof queueName) {
  target
    .on("active", (job) => {
      addBreadcrumb({
        category: "queue",
        message: `Job ${job.id} active`,
        level: "info",
        data: { job: job.data },
      });
    })
    .on("completed", (job) => {
      addBreadcrumb({
        category: "queue",
        message: `Job ${job.id} completed`,
        level: "info",
        data: { job: job.data },
      });
    })
    .on("error", (error) => {
      captureException(error, { level: "error", tags: { queue: name } });
    })
    .on("failed", (job, error) => {
      captureException(error, { level: "error", extra: { job: job?.data } });
    });
  return target;
}

function insideWindow(window: CheckDebts["window"], remaining: number) {
  return window === "24h"
    ? remaining >= 23 * 3600 && remaining <= 24 * 3600
    : remaining >= 55 * 60 && remaining <= 3600;
}
