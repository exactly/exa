import { SPAN_STATUS_ERROR } from "@sentry/core";
import { addBreadcrumb, captureException, startSpan, type Span } from "@sentry/node";
import { Queue, Worker, type Job } from "bullmq";
import * as v from "valibot";
import { ContractFunctionExecutionError } from "viem";

import { marketAbi, marketUSDCAddress, marketWETHAddress } from "@exactly/common/generated/chain";
import { MATURITY_INTERVAL } from "@exactly/lib";

import database, { credentials } from "../database";
import hasMaturity from "../utils/hasMaturity";
import { sendPushNotification } from "../utils/onesignal";
import publicClient from "../utils/publicClient";
import redis from "../utils/redis";

const QUEUE_NAME = "maturity-notifications";

export const MaturityJob = {
  CHECK_DEBTS: "check-debts",
} as const;

const DEBT_NOTIFICATION_MARKETS = [marketUSDCAddress, marketWETHAddress] as const;

const accountsTupleSchema = v.tuple([v.bigint(), v.bigint(), v.bigint()]);
const positionTupleSchema = v.tuple([v.bigint(), v.bigint()]);

let _maturityQueue: Queue | undefined;

export function getMaturityQueue(): Queue {
  _maturityQueue ??= new Queue(QUEUE_NAME, {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: true,
    },
  });
  return _maturityQueue;
}

type DebtCheckResult = {
  contractCalls: number;
  users: { account: string; hasDebt: boolean }[];
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
            let totalUsersProcessed = 0;

            for (let offset = 0; ; offset += CHUNK_SIZE) {
              const chunk = await database
                .select({ account: credentials.account })
                .from(credentials)
                .orderBy(credentials.account)
                .limit(CHUNK_SIZE)
                .offset(offset);
              if (chunk.length === 0) break;
              totalUsersProcessed += chunk.length;
              try {
                const results = await checkDebtsMarketImplementation(chunk, maturity);

                totalContractCalls += results.contractCalls;
                const notifications: Promise<unknown>[] = [];
                for (const { account, hasDebt } of results.users) {
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
              message: `processed ${String(totalUsersProcessed)} users`,
              level: "info",
              data: {
                totalContractCalls,
                usersProcessed: totalUsersProcessed,
                callsPerUser: totalUsersProcessed > 0 ? totalContractCalls / totalUsersProcessed : 0,
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

type AccountCall = {
  account: string;
  market: string;
};

async function checkDebtsMarketImplementation(
  chunk: { account: string }[],
  maturity: number,
): Promise<DebtCheckResult> {
  let contractCalls = 0;

  const accountCalls: AccountCall[] = [];
  const accountPromises: Promise<unknown>[] = [];
  for (const { account } of chunk) {
    for (const market of DEBT_NOTIFICATION_MARKETS) {
      accountCalls.push({ account, market });
      accountPromises.push(
        publicClient.readContract({
          address: market,
          abi: marketAbi,
          functionName: "accounts",
          args: [account as `0x${string}`],
        }),
      );
    }
  }

  const accountResults = await Promise.allSettled(accountPromises);
  contractCalls += accountCalls.length;

  const positionCalls: AccountCall[] = [];
  const positionPromises: Promise<unknown>[] = [];
  const userDebt = new Map<string, boolean>();

  for (const { account } of chunk) {
    userDebt.set(account, false);
  }

  for (const [index, result] of accountResults.entries()) {
    if (!accountCalls[index]) continue;

    const { account, market } = accountCalls[index];
    if (result.status === "rejected") {
      if (result.reason instanceof ContractFunctionExecutionError) continue;
      captureException(result.reason, { extra: { account, market } });
      continue;
    }
    const tupleResult = v.safeParse(accountsTupleSchema, result.value);
    if (!tupleResult.success) {
      captureException(tupleResult.issues, { extra: { account, market, value: result.value } });
      continue;
    }
    const [fixedBorrows] = tupleResult.output;
    if (hasMaturity(fixedBorrows, maturity)) {
      positionCalls.push({ account, market });
      positionPromises.push(
        publicClient.readContract({
          address: market as `0x${string}`,
          abi: marketAbi,
          functionName: "fixedBorrowPositions",
          args: [BigInt(maturity), account as `0x${string}`],
        }),
      );
    }
  }

  if (positionPromises.length > 0) {
    const positionResults = await Promise.allSettled(positionPromises);
    contractCalls += positionCalls.length;
    for (const [index, result] of positionResults.entries()) {
      if (!positionCalls[index]) continue;

      const { account } = positionCalls[index];
      if (result.status === "rejected") {
        if (result.reason instanceof ContractFunctionExecutionError) continue;
        captureException(result.reason, { extra: { account } });
        continue;
      }
      const positionResult = v.safeParse(positionTupleSchema, result.value);
      if (!positionResult.success) {
        captureException(positionResult.issues, { extra: { account, value: result.value } });
        continue;
      }
      const [principal] = positionResult.output;
      if (principal > 0n) {
        userDebt.set(account, true);
      }
    }
  }

  const users = [...userDebt.entries()].map(([account, hasDebt]) => ({
    account,
    hasDebt,
  }));

  return { contractCalls, users };
}

let maturityWorker: undefined | Worker;

export function initializeWorker(): void {
  if (maturityWorker) return;

  try {
    maturityWorker = new Worker(QUEUE_NAME, processor, { connection: redis });
  } catch (error) {
    captureException(error, { level: "error", tags: { queue: QUEUE_NAME, phase: "initialization" } });
    return;
  }

  maturityWorker
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
      captureException(error, { tags: { queue: QUEUE_NAME } });
    });
}

export async function close() {
  await Promise.all([maturityWorker?.close() ?? Promise.resolve(), _maturityQueue?.close() ?? Promise.resolve()]);
  maturityWorker = undefined;
  _maturityQueue = undefined;
}

export async function scheduleMaturityChecks(afterMaturity?: number) {
  const now = Math.floor(Date.now() / 1000);
  const nextMaturity =
    afterMaturity === undefined
      ? now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL
      : afterMaturity + MATURITY_INTERVAL;

  await getMaturityQueue().add(
    MaturityJob.CHECK_DEBTS,
    { maturity: nextMaturity, window: "24h" },
    {
      jobId: `check-debts-${nextMaturity}-24h`,
      delay: Math.max(0, (nextMaturity - 24 * 3600 - now) * 1000),
    },
  );

  await getMaturityQueue().add(
    MaturityJob.CHECK_DEBTS,
    { maturity: nextMaturity, window: "1h" },
    {
      jobId: `check-debts-${nextMaturity}-1h`,
      delay: Math.max(0, (nextMaturity - 3600 - now) * 1000),
    },
  );
}
