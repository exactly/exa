import { SPAN_STATUS_ERROR } from "@sentry/core";
import { addBreadcrumb, captureException, startSpan } from "@sentry/node";
import { Queue, Worker, type Job } from "bullmq";
import { number, object, optional, parse, picklist, type InferOutput } from "valibot";

import { previewerAbi, previewerAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL } from "@exactly/lib";

import { sendPushNotification } from "./onesignal";
import publicClient from "./publicClient";
import { queue as redis } from "./redis";
import database, { credentials } from "../database";
import t from "../i18n";

const queueName = "maturity";

const queue = new Queue<CheckDebts>(queueName, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

const checkDebtsSchema = object({ maturity: optional(number()), window: picklist(["1h", "24h"]) });

type CheckDebts = InferOutput<typeof checkDebtsSchema>;

const worker = new Worker<CheckDebts>(
  queueName,
  (job) =>
    startSpan(
      { name: "maturity.processor", op: "queue.process", attributes: { job: job.name, ...job.data } },
      async (span) => {
        const check = parse(checkDebtsSchema, job.data);
        switch (job.name) {
          case "check-debts": {
            const now = Math.floor(Date.now() / 1000);
            const maturity = check.maturity ?? nextMaturity(now);
            const remaining = maturity - now;
            const expected = check.window === "24h" ? 24 * 3600 : 3600;
            const earliest = check.window === "24h" ? 23 * 3600 : 55 * 60;
            if (remaining < earliest || remaining > expected) {
              addBreadcrumb({
                category: "maturity-queue",
                message: "stale job skipped",
                level: "warning",
                data: { maturity, window: check.window, now, remaining },
              });
              break;
            }
            const CHUNK_SIZE = 50;
            let totalContractCalls = 0;
            let notificationFailures = 0;
            let rpcFailures = 0;

            for (let offset = 0; ; offset += CHUNK_SIZE) {
              const chunk = await database.query.credentials.findMany({
                columns: { account: true },
                orderBy: credentials.account,
                limit: CHUNK_SIZE,
                offset,
              });
              if (chunk.length === 0) break;
              const markets = await Promise.allSettled(
                chunk.map(({ account }) =>
                  publicClient.readContract({
                    address: previewerAddress,
                    abi: previewerAbi,
                    functionName: "exactly",
                    args: [parse(Address, account)],
                  }),
                ),
              );
              totalContractCalls += chunk.length;
              const accounts = chunk.flatMap(({ account }, index) => {
                const result = markets[index];
                if (!result || result.status === "rejected") {
                  rpcFailures += 1;
                  captureException(result?.reason ?? new Error("missing market result"), {
                    level: "error",
                    extra: { account, kind: "rpc", maturity, window: check.window },
                  });
                  return [];
                }
                return result.value.some((market) =>
                  market.fixedBorrowPositions.some(
                    (p) => p.maturity === BigInt(maturity) && p.position.principal + p.position.fee > 0n,
                  ),
                )
                  ? [account]
                  : [];
              });
              const results = await Promise.allSettled(
                accounts.map(async (account) => {
                  const userId = parse(Address, account);
                  const key = `notification:sent:${userId}:${maturity}:${check.window}`;
                  if ((await redis.get(key)) !== null) return;
                  await sendPushNotification({
                    userId,
                    headings: t("Payment due soon"),
                    contents: t(
                      check.window === "24h"
                        ? "Your debt is due in 24 hours. Repay now to avoid penalties."
                        : "Your debt is due in 1 hour. Repay now to avoid penalties.",
                    ),
                  });
                  await redis.set(key, String(Date.now()), "EX", 86_400);
                }),
              );
              for (const [index, result] of results.entries()) {
                if (result.status === "rejected") {
                  notificationFailures += 1;
                  captureException(result.reason, {
                    level: "error",
                    extra: { account: accounts[index], kind: "notification", maturity, window: check.window },
                  });
                }
              }
              if (chunk.length < CHUNK_SIZE) break;
            }
            addBreadcrumb({
              category: "maturity-queue",
              message: "processed accounts",
              level: "info",
              data: { notificationFailures, rpcFailures, totalContractCalls },
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
  { connection: redis },
);

worker
  .on("active", (job: Job<CheckDebts>) => {
    addBreadcrumb({
      category: "queue",
      message: `Job ${job.id} active`,
      level: "info",
      data: { job: job.data },
    });
  })
  .on("completed", (job: Job<CheckDebts>) => {
    addBreadcrumb({
      category: "queue",
      message: `Job ${job.id} completed`,
      level: "info",
      data: { job: job.data },
    });
  })
  .on("error", (error: Error) => {
    captureException(error, { level: "error", tags: { queue: queueName } });
  })
  .on("failed", (job: Job<CheckDebts> | undefined, error: Error) => {
    captureException(error, { level: "error", extra: { job: job?.data } });
  });

export function closeQueue() {
  return Promise.all([worker.close(), queue.close()]);
}

export function scheduleMaturityChecks() {
  const now = Math.floor(Date.now() / 1000);
  return Promise.all([
    queue.upsertJobScheduler(
      "check-debts-24h",
      { every: MATURITY_INTERVAL * 1000, startDate: startDate(now, 24 * 3600) },
      { name: "check-debts", data: { window: "24h" } },
    ),
    queue.upsertJobScheduler(
      "check-debts-1h",
      { every: MATURITY_INTERVAL * 1000, startDate: startDate(now, 3600) },
      { name: "check-debts", data: { window: "1h" } },
    ),
  ]);
}

function startDate(now: number, offset: number) {
  let start = nextMaturity(now) - offset;
  while (start <= now) start += MATURITY_INTERVAL;
  return new Date(start * 1000);
}

function nextMaturity(now: number) {
  return now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
}
