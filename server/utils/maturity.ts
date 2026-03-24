import { SPAN_STATUS_ERROR } from "@sentry/core";
import { addBreadcrumb, captureException, startSpan } from "@sentry/node";
import { Queue, Worker, type Job } from "bullmq";
import { number, object, parse, picklist, type InferOutput } from "valibot";

import { previewerAbi, previewerAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL } from "@exactly/lib";

import { sendPushNotification } from "./onesignal";
import publicClient from "./publicClient";
import { queue as redis } from "./redis";
import database, { credentials } from "../database";
import t from "../i18n";

const queueName = "maturity";

export const queue = new Queue<CheckDebts>(queueName, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

const checkDebtsSchema = object({ maturity: number(), window: picklist(["1h", "24h"]) });

export type CheckDebts = InferOutput<typeof checkDebtsSchema>;

async function processor(job: Job<CheckDebts>) {
  return startSpan(
    { name: "maturity.processor", op: "queue.process", attributes: { job: job.name, ...job.data } },
    async (span) => {
      switch (job.name) {
        case "check-debts":
          try {
            const { maturity, window } = parse(checkDebtsSchema, job.data);
            const now = Math.floor(Date.now() / 1000);
            if (maturity - now < 0 || maturity - now > (window === "24h" ? 24 * 3600 : 3600)) {
              addBreadcrumb({
                category: "maturity-queue",
                message: "stale job skipped",
                level: "warning",
                data: { maturity, window, now },
              });
              break;
            }
            const CHUNK_SIZE = 50;
            let totalContractCalls = 0;
            const failures: unknown[] = [];

            for (let offset = 0; ; offset += CHUNK_SIZE) {
              const chunk = await database.query.credentials.findMany({
                columns: { account: true },
                orderBy: credentials.account,
                limit: CHUNK_SIZE,
                offset,
              });
              if (chunk.length === 0) break;
              const markets = await Promise.all(
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
              for (const result of await Promise.allSettled(
                chunk
                  .filter((_, index) =>
                    markets[index]?.some((market) =>
                      market.fixedBorrowPositions.some(
                        (p) => p.maturity === BigInt(maturity) && p.position.principal > 0n,
                      ),
                    ),
                  )
                  .map(async ({ account }) => {
                    const userId = parse(Address, account);
                    const key = `notification:sent:${userId}:${maturity}:${window}`;
                    if ((await redis.get(key)) !== null) return;
                    await sendPushNotification({
                      userId,
                      headings: t("Debt Maturity Alert"),
                      contents: t(
                        window === "24h"
                          ? "Your debt is due in 24 hours. Repay now to avoid liquidation."
                          : "Your debt is due in 1 hour. Repay now to avoid liquidation.",
                      ),
                    });
                    await redis.set(key, String(Date.now()), "EX", 86_400);
                  }),
              )) {
                if (result.status === "rejected") {
                  captureException(result.reason, { level: "error" });
                  failures.push(result.reason);
                }
              }
              if (chunk.length < CHUNK_SIZE) break;
            }
            addBreadcrumb({
              category: "maturity-queue",
              message: "processed accounts",
              level: "info",
              data: { totalContractCalls },
            });
            if (failures.length > 0) throw new AggregateError(failures, "notification failures");
          } finally {
            try {
              await scheduleMaturityChecks(job.data.maturity);
            } catch (error: unknown) {
              captureException(error, { level: "fatal" });
            }
          }
          break;

        default: {
          const message = `Unknown job name: ${job.name}`;
          span.setStatus({ code: SPAN_STATUS_ERROR, message });
          throw new Error(message);
        }
      }
    },
  );
}

export const worker = new Worker<CheckDebts>(queueName, processor, { connection: redis });

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

export async function scheduleMaturityChecks(afterMaturity?: number) {
  const now = Math.floor(Date.now() / 1000);
  let nextMaturity =
    afterMaturity === undefined
      ? now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL
      : afterMaturity + MATURITY_INTERVAL;
  while (nextMaturity <= now) nextMaturity += MATURITY_INTERVAL;

  const delay24h = (nextMaturity - 24 * 3600 - now) * 1000;
  if (delay24h >= 0) {
    await queue.add(
      "check-debts",
      { maturity: nextMaturity, window: "24h" },
      {
        jobId: `check-debts-${nextMaturity}-24h`,
        delay: delay24h,
      },
    );
  }

  const delay1h = (nextMaturity - 3600 - now) * 1000;
  if (delay1h >= 0) {
    await queue.add(
      "check-debts",
      { maturity: nextMaturity, window: "1h" },
      {
        jobId: `check-debts-${nextMaturity}-1h`,
        delay: delay1h,
      },
    );
  }
}
