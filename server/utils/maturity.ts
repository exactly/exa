import { SPAN_STATUS_ERROR, SPAN_STATUS_OK, type Span } from "@sentry/core";
import {
  addBreadcrumb,
  captureException,
  continueTrace,
  spanToBaggageHeader,
  spanToTraceHeader,
  startSpan,
} from "@sentry/node";
import { Queue, Worker, type Job } from "bullmq";
import { v5 } from "uuid";
import { array, number, object, optional, parse, picklist, string, type InferOutput } from "valibot";
import { decodeFunctionResult, encodeFunctionData, multicall3Abi } from "viem";

import chain, { marketAbi, marketUSDCAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL } from "@exactly/lib";

import publicClient from "./publicClient";
import { bullmq as connection } from "./redis";
import database, { credentials } from "../database";
import t from "../i18n";

import type createOnesignal from "./onesignal";

export function setup(onesignal: ReturnType<typeof createOnesignal>) {
  ({ sendPushNotification } = onesignal);
}

let sendPushNotification: ReturnType<typeof createOnesignal>["sendPushNotification"];

const queueName = "maturity";
const notificationQueueName = "maturity-notifications";
const chunkSize = 768;
const windowSchema = picklist(["1h", "24h"]);

const traceSchema = { sentryBaggage: optional(string()), sentryTrace: optional(string()) };
const checkDebtsSchema = object({ window: windowSchema, ...traceSchema });
const scanChunkSchema = object({
  accounts: array(Address),
  chunkIndex: number(),
  maturity: number(),
  window: windowSchema,
  ...traceSchema,
});
const sendMaturityRemindersSchema = object({
  accounts: array(Address),
  maturity: number(),
  window: windowSchema,
  ...traceSchema,
});

type CheckDebts = InferOutput<typeof checkDebtsSchema>;
type ScanChunk = InferOutput<typeof scanChunkSchema>;
type SendMaturityReminders = InferOutput<typeof sendMaturityRemindersSchema>;

function processJob<T extends { sentryBaggage?: string; sentryTrace?: string }, R>(
  job: Job<T>,
  destination: string,
  name: string,
  process: (span: Span) => Promise<R>,
) {
  function callback() {
    return startSpan({ name: `${job.name} worker`, forceTransaction: true }, (parent) =>
      startSpan(
        {
          name,
          op: "queue.process",
          attributes: {
            "messaging.destination.name": destination,
            "messaging.message.body.size": Buffer.byteLength(JSON.stringify(job.data)),
            "messaging.message.id": job.id,
            "messaging.message.receive.latency": Date.now() - job.timestamp,
            "messaging.message.retry.count": job.attemptsMade,
          },
        },
        async (span) => {
          try {
            const result = await process(span);
            span.setStatus({ code: SPAN_STATUS_OK });
            parent.setStatus({ code: SPAN_STATUS_OK });
            return result;
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "queue process failed";
            span.setStatus({ code: SPAN_STATUS_ERROR, message });
            parent.setStatus({ code: SPAN_STATUS_ERROR, message });
            throw error;
          }
        },
      ),
    );
  }
  return job.data.sentryTrace || job.data.sentryBaggage
    ? continueTrace({ sentryTrace: job.data.sentryTrace, baggage: job.data.sentryBaggage }, callback)
    : callback();
}

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
      processJob(job, queueName, "maturity.worker", async (span) => {
        span.setAttributes({ job: job.name, window: job.data.window });
        switch (job.name) {
          case "check-debts": {
            const check = parse(checkDebtsSchema, job.data);
            const maturity = (Math.floor(Date.now() / 1000 / MATURITY_INTERVAL) + 1) * MATURITY_INTERVAL;
            const accounts = await database.query.credentials
              .findMany({ columns: { account: true }, orderBy: credentials.account })
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
            if (jobs.length > 0)
              await startSpan(
                {
                  name: "maturity.scan.publish",
                  op: "queue.publish",
                  attributes: {
                    "messaging.destination.name": queueName,
                    "maturity.chunk_count": jobs.length,
                  },
                },
                async (publishSpan) => {
                  publishSpan.setAttribute(
                    "messaging.message.id",
                    await queue
                      .addBulk(
                        jobs.map(({ name, data, opts }) => ({
                          name,
                          data: {
                            ...data,
                            sentryBaggage: spanToBaggageHeader(publishSpan),
                            sentryTrace: spanToTraceHeader(publishSpan),
                          },
                          opts,
                        })),
                      )
                      .then((published) => published[0]?.id ?? job.id ?? job.name),
                  );
                  publishSpan.setAttribute("messaging.message.body.size", Buffer.byteLength(JSON.stringify(jobs)));
                },
              );
            break;
          }

          case "scan-chunk": {
            const scan = parse(scanChunkSchema, job.data);
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
            if (accounts.length > 0) {
              const id = `maturity-reminders-${scan.maturity}-${scan.window}-${scan.chunkIndex}`;
              await startSpan(
                {
                  name: "maturity.notification.publish",
                  op: "queue.publish",
                  attributes: {
                    "messaging.destination.name": notificationQueueName,
                    "maturity.account_count": accounts.length,
                  },
                },
                async (publishSpan) => {
                  publishSpan.setAttribute(
                    "messaging.message.id",
                    await notificationQueue
                      .add(
                        "send-maturity-reminders",
                        {
                          accounts,
                          maturity: scan.maturity,
                          sentryBaggage: spanToBaggageHeader(publishSpan),
                          sentryTrace: spanToTraceHeader(publishSpan),
                          window: scan.window,
                        },
                        { jobId: id },
                      )
                      .then((created) => created.id),
                  );
                  publishSpan.setAttribute(
                    "messaging.message.body.size",
                    Buffer.byteLength(JSON.stringify({ accounts, maturity: scan.maturity, window: scan.window })),
                  );
                },
              );
            }
            break;
          }

          default: {
            const message = `Unknown job name: ${job.name}`;
            span.setStatus({ code: SPAN_STATUS_ERROR, message });
            throw new Error(message);
          }
        }
      }),
    { connection, concurrency: 3 },
  ),
  queueName,
);

const notificationWorker = observe(
  new Worker<SendMaturityReminders>(
    notificationQueueName,
    (job) =>
      processJob(job, notificationQueueName, "maturity.notification", async (span) => {
        span.setAttributes({
          job: job.name,
          maturity: job.data.maturity,
          window: job.data.window,
          accounts: job.data.accounts.length,
        });
        const reminder = parse(sendMaturityRemindersSchema, job.data);
        switch (job.name) {
          case "send-maturity-reminders": {
            const failedAccounts: Address[] = [];
            for (let offset = 0; offset < reminder.accounts.length; offset += 50) {
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
                    ttl: Math.max(0, reminder.maturity - Math.floor(Date.now() / 1000)),
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
      }),
    { connection, concurrency: 3 },
  ),
  notificationQueueName,
);

export async function closeQueue() {
  const results = await Promise.allSettled([
    worker.close(),
    notificationWorker.close(),
    queue.close(),
    notificationQueue.close(),
  ]);
  const errors = results.flatMap((result) =>
    result.status === "rejected"
      ? [result.reason instanceof Error ? result.reason : new Error(String(result.reason))]
      : [],
  );
  if (errors.length > 0) throw new AggregateError(errors, "closing maturity queue failed");
}

export async function reminders() {
  await queue.setGlobalConcurrency(3);
  const [scheduled24h, scheduled1h] = await Promise.all([
    queue.getJobScheduler("check-debts-24h"),
    queue.getJobScheduler("check-debts-1h"),
  ]);
  const timestamp = Date.now();
  const now = Math.floor(timestamp / 1000);
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
  const every = MATURITY_INTERVAL * 1000;
  const offset1h = -3600 * 1000;
  const offset24h = 24 * offset1h;
  return Promise.all([
    queue.upsertJobScheduler(
      "check-debts-24h",
      { every, offset: offset24h, startDate: Math.ceil((timestamp - offset24h) / every) * every + offset24h },
      { name: "check-debts", data: { window: "24h" } },
    ),
    queue.upsertJobScheduler(
      "check-debts-1h",
      { every, offset: offset1h, startDate: Math.ceil((timestamp - offset1h) / every) * every + offset1h },
      { name: "check-debts", data: { window: "1h" } },
    ),
  ]);
}

function observe<T>(target: Worker<T>, name: typeof notificationQueueName | typeof queueName) {
  target
    .on("error", (error) => {
      captureException(error, { level: "error", tags: { queue: name } });
    })
    .on("failed", (job, error) => {
      captureException(error, { level: "error", extra: { job: job?.data } });
    });
  return target;
}
