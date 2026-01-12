import { previewerAbi, previewerAddress } from "@exactly/common/generated/chain";
import { addBreadcrumb, captureException } from "@sentry/node";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { ContractFunctionExecutionError } from "viem";

import { MaturityJob, QueueName } from "./constants";
import database, { credentials, notificationHistory } from "../database";
import { sendPushNotification } from "../utils/onesignal";
import publicClient from "../utils/publicClient";

const MATURITY_INTERVAL = 2_419_200; // 4 weeks
const disableWorkers = process.env.DISABLE_WORKERS === "true";

const connection = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : {
      host: process.env.REDIS_HOST ?? "localhost",
      port: Number(process.env.REDIS_PORT ?? 6379),
    };

export const maturityQueue = new Queue(QueueName.MATURITY, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: true,
  },
});

export interface CheckDebtsData {
  maturity: number;
  window: "24h" | "1h";
}

export const processor = async (job: Job<CheckDebtsData>) => {
  if (job.name !== MaturityJob.CHECK_DEBTS) return;

  const { maturity, window } = job.data;

  const users = await database.select({ account: credentials.account }).from(credentials);

  const CHUNK_SIZE = 250;
  for (let offset = 0; offset < users.length; offset += CHUNK_SIZE) {
    const chunk = users.slice(offset, offset + CHUNK_SIZE);

    try {
      const results = await Promise.all(
        chunk.map(({ account }) =>
          publicClient
            .readContract({
              address: previewerAddress,
              abi: previewerAbi,
              functionName: "exactly",
              args: [account as `0x${string}`],
            })
            .then((result) => ({ status: "success" as const, result }))
            .catch((error: unknown) => ({ status: "failure" as const, error })),
        ),
      );

      const notifications: Promise<unknown>[] = [];

      for (const [index, result] of results.entries()) {
        const user = chunk[index];
        if (!user) continue;

        if (result.status === "failure") {
          if (result.error instanceof ContractFunctionExecutionError) continue;
          captureException(result.error, { extra: { account: user.account } });
          continue;
        }

        const data = result.result as unknown as {
          fixedBorrowPositions: { maturity: bigint; position: { principal: bigint } }[];
        }[];

        const hasDebt = data.some((marketAccount) =>
          marketAccount.fixedBorrowPositions.some(
            (position) => Number(position.maturity) === maturity && position.position.principal > 0n,
          ),
        );

        if (hasDebt) {
          const account = user.account;
          notifications.push(
            database
              .insert(notificationHistory)
              .values({ account, maturity: BigInt(maturity), window })
              .onConflictDoNothing()
              .returning()
              .then((rows) => {
                if (rows.length > 0) {
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
      await Promise.all(notifications);
    } catch (error: unknown) {
      captureException(error);
    }
  }

  if (window === "1h") {
    await scheduleMaturityChecks();
  }
};

if (!disableWorkers) {
  new Worker(QueueName.MATURITY, processor, { connection })
    .on("failed", (job, error: Error) => {
      captureException(error, { extra: { job: job?.data } });
    })
    .on("completed", (job) => {
      addBreadcrumb({
        category: "queue",
        message: `Job ${job.id} completed`,
        level: "info",
        data: { job: job.data },
      });
    })
    .on("active", (job) => {
      addBreadcrumb({
        category: "queue",
        message: `Job ${job.id} active`,
        level: "info",
        data: { job: job.data },
      });
    })
    .on("error", (error: Error) => {
      captureException(error, { tags: { queue: QueueName.MATURITY } });
    });
}

export async function scheduleMaturityChecks() {
  const now = Math.floor(Date.now() / 1000);
  const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;

  await maturityQueue.add(
    MaturityJob.CHECK_DEBTS,
    { maturity: nextMaturity, window: "24h" },
    {
      jobId: `check-debts-${nextMaturity}-24h`,
      delay: (nextMaturity - 24 * 3600 - now) * 1000,
    },
  );

  await maturityQueue.add(
    MaturityJob.CHECK_DEBTS,
    { maturity: nextMaturity, window: "1h" },
    {
      jobId: `check-debts-${nextMaturity}-1h`,
      delay: (nextMaturity - 3600 - now) * 1000,
    },
  );
}
