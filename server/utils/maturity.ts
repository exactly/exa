import { SPAN_STATUS_ERROR } from "@sentry/core";
import { addBreadcrumb, captureException, startSpan, type Span } from "@sentry/node";
import { Queue, Worker, type Job } from "bullmq";
import * as v from "valibot";

import { previewerAbi, previewerAddress } from "@exactly/common/generated/chain";
import { MATURITY_INTERVAL } from "@exactly/lib";

import { sendPushNotification } from "./onesignal";
import publicClient from "./publicClient";
import { queue as redis } from "./redis";
import database, { credentials } from "../database";

const queueName = "maturity-notifications";

export const MaturityJob = {
  CHECK_DEBTS: "check-debts",
} as const;

export const queue = new Queue(queueName, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

type DebtCheckResult = {
  accounts: { account: string; hasDebt: boolean }[];
  contractCalls: number;
};

const checkDebtsSchema = v.object({
  maturity: v.number(),
  window: v.picklist(["1h", "24h"]),
});

export type CheckDebtsData = v.InferOutput<typeof checkDebtsSchema>;

export async function processor(job: Job<CheckDebtsData>) {
  return startSpan(
    { name: "maturity.processor", op: "queue.process", attributes: { job: job.name, ...job.data } },
    async (span: Span) => {
      switch (job.name) {
        case MaturityJob.CHECK_DEBTS: {
          const parseResult = v.safeParse(checkDebtsSchema, job.data);
          if (!parseResult.success) {
            captureException(parseResult.issues, { extra: { jobData: job.data } });
            return;
          }
          const { maturity, window } = parseResult.output;
          try {
            const CHUNK_SIZE = 50;
            let totalContractCalls = 0;
            let totalAccountsProcessed = 0;

            for (let offset = 0; ; offset += CHUNK_SIZE) {
              const chunk = await database
                .select({ account: credentials.account })
                .from(credentials)
                .orderBy(credentials.account)
                .limit(CHUNK_SIZE)
                .offset(offset);
              if (chunk.length === 0) break;
              totalAccountsProcessed += chunk.length;
              try {
                const results = await checkDebts(chunk, maturity);

                totalContractCalls += results.contractCalls;
                const notifications: Promise<unknown>[] = [];
                for (const { account, hasDebt } of results.accounts) {
                  if (hasDebt) {
                    notifications.push(
                      redis
                        .set(
                          `notification:sent:${account}:${maturity}:${window}`,
                          String(Date.now()),
                          "EX",
                          86_400,
                          "NX",
                        )
                        .then((r) => {
                          if (r === "OK") {
                            return sendPushNotification({
                              userId: account,
                              headings: { en: "Debt Maturity Alert" },
                              contents: {
                                en: `Your debt is due in ${window === "24h" ? "24 hours" : "1 hour"}. Repay now to avoid liquidation.`,
                              },
                            });
                          }
                        }),
                    );
                  }
                }

                for (const result of await Promise.allSettled(notifications)) {
                  if (result.status === "rejected") captureException(result.reason, { level: "error" });
                }
              } catch (error: unknown) {
                captureException(error);
              }
              if (chunk.length < CHUNK_SIZE) break;
            }
            addBreadcrumb({
              category: "maturity-queue",
              message: `processed ${String(totalAccountsProcessed)} accounts`,
              level: "info",
              data: {
                totalContractCalls,
                accountsProcessed: totalAccountsProcessed,
                callsPerAccount: totalAccountsProcessed > 0 ? totalContractCalls / totalAccountsProcessed : 0,
              },
            });
          } finally {
            if (window === "1h") {
              await scheduleMaturityChecks(maturity);
            }
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
  );
}

async function checkDebts(chunk: { account: string }[], maturity: number): Promise<DebtCheckResult> {
  const promises = chunk.map(({ account }) =>
    publicClient.readContract({
      address: previewerAddress,
      abi: previewerAbi,
      functionName: "exactly",
      args: [account as `0x${string}`],
    }),
  );

  const results = await Promise.allSettled(promises);
  const accounts: DebtCheckResult["accounts"] = [];

  for (const [index, result] of results.entries()) {
    const entry = chunk[index];
    if (!entry) continue;
    const { account } = entry;
    if (result.status === "rejected") {
      captureException(result.reason, { extra: { account } });
      continue;
    }
    const hasDebt = result.value.some((market) =>
      market.fixedBorrowPositions.some((p) => p.maturity === BigInt(maturity) && p.position.principal > 0n),
    );
    accounts.push({ account, hasDebt });
  }

  return { accounts, contractCalls: chunk.length };
}

const worker = new Worker(queueName, processor, { connection: redis });

worker
  .on("failed", (job: Job<CheckDebtsData> | undefined, error: Error) => {
    captureException(error, { level: "error", extra: { job: job?.data } });
  })
  .on("completed", (job: Job<CheckDebtsData>) => {
    addBreadcrumb({
      category: "queue",
      message: `Job ${job.id} completed`,
      level: "info",
      data: { job: job.data },
    });
  })
  .on("active", (job: Job<CheckDebtsData>) => {
    addBreadcrumb({
      category: "queue",
      message: `Job ${job.id} active`,
      level: "info",
      data: { job: job.data },
    });
  })
  .on("error", (error: Error) => {
    captureException(error, { tags: { queue: queueName } });
  });

export async function closeQueue() {
  await Promise.all([worker.close(), queue.close()]);
}

export async function scheduleMaturityChecks(afterMaturity?: number) {
  const now = Math.floor(Date.now() / 1000);
  const nextMaturity =
    afterMaturity === undefined
      ? now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL
      : afterMaturity + MATURITY_INTERVAL;

  await queue.add(
    MaturityJob.CHECK_DEBTS,
    { maturity: nextMaturity, window: "24h" },
    {
      jobId: `check-debts-${nextMaturity}-24h`,
      delay: Math.max(0, (nextMaturity - 24 * 3600 - now) * 1000),
    },
  );

  await queue.add(
    MaturityJob.CHECK_DEBTS,
    { maturity: nextMaturity, window: "1h" },
    {
      jobId: `check-debts-${nextMaturity}-1h`,
      delay: Math.max(0, (nextMaturity - 3600 - now) * 1000),
    },
  );
}
