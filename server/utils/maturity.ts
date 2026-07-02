import { SPAN_STATUS_ERROR } from "@sentry/core";
import { addBreadcrumb, captureException, startSpan } from "@sentry/node";
import { Queue, Worker } from "bullmq";
import { createHash } from "node:crypto";
import { number, object, optional, parse, picklist, type InferOutput } from "valibot";

import { previewerAbi, previewerAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL, WAD } from "@exactly/lib";

import { sendPushNotification } from "./onesignal";
import publicClient from "./publicClient";
import { queue as connection } from "./redis";
import database, { credentials } from "../database";
import t from "../i18n";

const queueName = "maturity";
const notificationQueueName = "maturity-notifications";
const windowSchema = picklist(["1h", "24h"]);

const checkDebtsSchema = object({ maturity: optional(number()), window: windowSchema });
const sendMaturityReminderSchema = object({ maturity: number(), userId: Address, window: windowSchema });

type CheckDebts = InferOutput<typeof checkDebtsSchema>;
type SendMaturityReminder = InferOutput<typeof sendMaturityReminderSchema>;
type MaturityWindow = CheckDebts["window"];
type Markets = Awaited<ReturnType<typeof readExactly>>;

const queue = new Queue<CheckDebts>(queueName, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

const notificationQueue = new Queue<SendMaturityReminder>(notificationQueueName, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

const worker = new Worker<CheckDebts>(
  queueName,
  (job) =>
    startSpan(
      { name: "maturity.processor", op: "queue.process", attributes: { job: job.name, ...job.data } },
      async (span) => {
        const check = parse(checkDebtsSchema, job.data);
        switch (job.name) {
          case "check-debts": {
            const maturity = check.maturity ?? nextMaturity(Math.floor(Date.now() / 1000));
            const CHUNK_SIZE = 50;
            let totalContractCalls = 0;
            let rpcFailures = 0;
            let queuedNotifications = 0;

            for (let offset = 0; ; offset += CHUNK_SIZE) {
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
              const chunk = await database.query.credentials.findMany({
                columns: { account: true },
                orderBy: credentials.account,
                limit: CHUNK_SIZE,
                offset,
              });
              if (chunk.length === 0) break;
              const markets = await Promise.allSettled(
                chunk.map(({ account }) => readExactly(parse(Address, account))),
              );
              totalContractCalls += chunk.length;
              const jobs = [];
              for (const [index, { account }] of chunk.entries()) {
                const result = markets[index];
                if (!result || result.status === "rejected") {
                  rpcFailures += 1;
                  captureException(result?.reason ?? new Error("missing market result"), {
                    level: "error",
                    extra: { account, kind: "rpc", maturity, window: check.window },
                  });
                  continue;
                }
                const userId = parse(Address, account);
                if (!hasDueDebt(result.value, maturity)) continue;
                if ((await connection.exists(sentKey(userId, maturity, check.window))) > 0) continue;
                jobs.push({
                  name: "send-maturity-reminder",
                  data: { userId, maturity, window: check.window },
                  opts: { jobId: `maturity-reminder-${userId}-${maturity}-${check.window}` },
                });
              }
              if (jobs.length > 0) {
                queuedNotifications += jobs.length;
                await notificationQueue.addBulk(jobs);
              }
              if (chunk.length < CHUNK_SIZE) break;
            }
            addBreadcrumb({
              category: "maturity-queue",
              message: "processed accounts",
              level: "info",
              data: { queuedNotifications, rpcFailures, totalContractCalls },
            });
            if (rpcFailures > 0) throw new Error("rpc failed");
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
  { connection },
);

const notificationWorker = new Worker<SendMaturityReminder>(
  notificationQueueName,
  (job) =>
    startSpan(
      { name: "maturity-notifications.processor", op: "queue.process", attributes: { job: job.name, ...job.data } },
      async (span) => {
        const reminder = parse(sendMaturityReminderSchema, job.data);
        switch (job.name) {
          case "send-maturity-reminder": {
            if ((await connection.exists(sentKey(reminder.userId, reminder.maturity, reminder.window))) > 0) break;
            let now = Math.floor(Date.now() / 1000);
            let remaining = reminder.maturity - now;
            if (!insideWindow(reminder.window, remaining)) {
              addBreadcrumb({
                category: notificationQueueName,
                message: "stale reminder skipped",
                level: "warning",
                data: { maturity: reminder.maturity, window: reminder.window, now, remaining, userId: reminder.userId },
              });
              break;
            }
            const markets = await readExactly(reminder.userId).catch((error: unknown) => {
              captureException(error, {
                level: "error",
                extra: {
                  account: reminder.userId,
                  kind: "notification-rpc",
                  maturity: reminder.maturity,
                  window: reminder.window,
                },
              });
              throw error;
            });
            if (!hasDueDebt(markets, reminder.maturity)) break;
            now = Math.floor(Date.now() / 1000);
            remaining = reminder.maturity - now;
            if (!insideWindow(reminder.window, remaining)) {
              addBreadcrumb({
                category: notificationQueueName,
                message: "stale reminder skipped",
                level: "warning",
                data: { maturity: reminder.maturity, window: reminder.window, now, remaining, userId: reminder.userId },
              });
              break;
            }
            await sendPushNotification({
              userId: reminder.userId,
              headings: t("Payment due soon"),
              contents: t(
                reminder.window === "24h"
                  ? "Your debt is due in 24 hours. Repay now to avoid penalties."
                  : "Your debt is due in 1 hour. Repay now to avoid penalties.",
              ),
              idempotencyKey: idempotencyKey(reminder),
              ttl: remaining,
            }).catch((error: unknown) => {
              captureException(error, {
                level: "error",
                extra: {
                  account: reminder.userId,
                  kind: "notification",
                  maturity: reminder.maturity,
                  window: reminder.window,
                },
              });
              throw error;
            });
            await connection.set(
              sentKey(reminder.userId, reminder.maturity, reminder.window),
              String(Date.now()),
              "EX",
              31 * 86_400,
            );
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
  { connection, concurrency: 50 },
);

observeWorker(worker, queueName);
observeWorker(notificationWorker, notificationQueueName);

export function closeQueue() {
  return Promise.allSettled([
    worker.close(),
    notificationWorker.close(),
    queue.close(),
    notificationQueue.close(),
  ]).then((results) => {
    const errors = results.flatMap((result) => (result.status === "rejected" ? Array.of<unknown>(result.reason) : []));
    if (errors.length > 0) throw new AggregateError(errors, "closing maturity queue failed");
  });
}

export async function reminders() {
  const now = Math.floor(Date.now() / 1000);
  const maturity = nextMaturity(now);
  const remaining = maturity - now;
  const jobs = await Promise.all([
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
  if (remaining >= 23 * 3600 && remaining <= 24 * 3600) {
    jobs.push(
      await queue.add(
        "check-debts",
        { maturity, window: "24h" },
        {
          jobId: `maturity-catch-up-${maturity}-24h`,
          removeOnComplete: { age: 2 * 3600 },
          removeOnFail: true,
        },
      ),
    );
  }
  if (remaining >= 55 * 60 && remaining <= 3600) {
    jobs.push(
      await queue.add(
        "check-debts",
        { maturity, window: "1h" },
        {
          jobId: `maturity-catch-up-${maturity}-1h`,
          removeOnComplete: { age: 2 * 3600 },
          removeOnFail: true,
        },
      ),
    );
  }
  return jobs;
}

function observeWorker<T>(target: Worker<T>, targetQueueName: string) {
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
      captureException(error, { level: "error", tags: { queue: targetQueueName } });
    })
    .on("failed", (job, error) => {
      captureException(error, { level: "error", extra: { job: job?.data } });
    });
}

function readExactly(account: Address) {
  return publicClient.readContract({
    address: previewerAddress,
    abi: previewerAbi,
    functionName: "exactly",
    args: [account],
  });
}

function hasDueDebt(markets: Markets, maturity: number) {
  const target = BigInt(maturity);
  return (
    markets.reduce(
      (total, market) =>
        total +
        market.fixedBorrowPositions.reduce(
          (subtotal, position) =>
            position.maturity === target
              ? subtotal +
                ((position.position.principal + position.position.fee) * market.usdPrice) /
                  10n ** BigInt(market.decimals)
              : subtotal,
          0n,
        ),
      0n,
    ) >=
    2n * WAD
  );
}

function insideWindow(window: MaturityWindow, remaining: number) {
  return window === "24h"
    ? remaining >= 23 * 3600 && remaining <= 24 * 3600
    : remaining >= 55 * 60 && remaining <= 3600;
}

function sentKey(userId: Address, maturity: number, window: MaturityWindow) {
  return `notification:sent:${userId}:${maturity}:${window}`;
}

function idempotencyKey({ maturity, userId, window }: SendMaturityReminder) {
  const hash = createHash("sha1")
    .update(Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex"))
    .update(`https://exact.ly/maturity-reminder/${userId}/${maturity}/${window}`)
    .digest();
  hash[6] = ((hash[6] ?? 0) & 0x0f) | 0x50;
  hash[8] = ((hash[8] ?? 0) & 0x3f) | 0x80;
  return hash
    .subarray(0, 16)
    .toString("hex")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/u, "$1-$2-$3-$4-$5");
}

function nextMaturity(now: number) {
  return now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
}
