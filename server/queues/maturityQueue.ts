import { addBreadcrumb, captureException } from "@sentry/node";
import { Queue, Worker, type Job } from "bullmq";
import { parse, picklist } from "valibot";
import { ContractFunctionExecutionError } from "viem";

import {
  marketAbi,
  marketUSDCAddress,
  marketWETHAddress,
  previewerAbi,
  previewerAddress,
} from "@exactly/common/generated/chain";
import { MATURITY_INTERVAL } from "@exactly/lib";

import database, { credentials } from "../database";
import hasMaturity from "../utils/hasMaturity";
import { sendPushNotification } from "../utils/onesignal";
import publicClient from "../utils/publicClient";
import redis from "../utils/redis";

const QUEUE_NAME = "maturity-notifications";

const MaturityJob = {
  CHECK_DEBTS: "check-debts",
} as const;

const DEBT_NOTIFICATION_MARKETS = [marketUSDCAddress, marketWETHAddress] as const;

const implementation = parse(
  picklist(["market", "previewer"]),
  process.env.DEBT_NOTIFICATION_IMPLEMENTATION ?? "market",
);

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
  errors?: Map<string, unknown>;
  users: { account: string; hasDebt: boolean }[];
};

export type CheckDebtsData = {
  maturity: number;
  window: "1h" | "24h";
};

export const processor = async (job: Job<CheckDebtsData>) => {
  if (job.name !== MaturityJob.CHECK_DEBTS) return;
  const { maturity, window } = job.data;
  try {
    const CHUNK_SIZE = 250;
    let totalContractCalls = 0;
    let totalUsersProcessed = 0;

    for (let offset = 0; ; offset += CHUNK_SIZE) {
      const chunk = await database
        .select({ account: credentials.account })
        .from(credentials)
        .limit(CHUNK_SIZE)
        .offset(offset);
      if (chunk.length === 0) break;
      totalUsersProcessed += chunk.length;
      try {
        const results =
          implementation === "market"
            ? await checkDebtsMarketImplementation(chunk, maturity)
            : await checkDebtsPreviewerImplementation(chunk, maturity);

        totalContractCalls += results.contractCalls;
        const notifications: Promise<unknown>[] = [];
        for (const { account, hasDebt } of results.users) {
          if (implementation === "previewer") {
            const errors = results.errors;
            const error = errors?.get(account);
            if (error) {
              if (error instanceof ContractFunctionExecutionError) continue;
              captureException(error, { extra: { account } });
              continue;
            }
          }
          if (hasDebt) {
            notifications.push(
              redis
                .set(`notification:sent:${account}:${maturity}:${window}`, String(Date.now()), "EX", 86_400, "NX")
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

        await Promise.all(notifications);
      } catch (error: unknown) {
        captureException(error);
      }
      if (chunk.length < CHUNK_SIZE) break;
    }
    addBreadcrumb({
      category: "maturity-queue",
      message: `processed ${String(totalUsersProcessed)} users using ${implementation} implementation`,
      level: "info",
      data: {
        implementation,
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
};

async function checkDebtsPreviewerImplementation(
  chunk: { account: string }[],
  maturity: number,
): Promise<DebtCheckResult> {
  const results = await Promise.all(
    chunk.map(({ account }) =>
      publicClient
        .readContract({
          address: previewerAddress,
          abi: previewerAbi,
          functionName: "exactly",
          args: [account as `0x${string}`],
        })
        .then((result) => ({ status: "success" as const, result, account }))
        .catch((error: unknown) => ({ status: "failure" as const, error, account })),
    ),
  );

  const errors = new Map<string, unknown>();
  const users = results.map((result) => {
    if (result.status === "failure") {
      errors.set(result.account, result.error);
      return { account: result.account, hasDebt: false };
    }
    const hasDebt = result.result.some((marketAccount) =>
      marketAccount.fixedBorrowPositions.some(
        (position) => Number(position.maturity) === maturity && position.position.principal > 0n,
      ),
    );
    return { account: result.account, hasDebt };
  });

  return {
    contractCalls: chunk.length,
    users,
    errors: errors.size > 0 ? errors : undefined,
  };
}

type AccountCall = {
  account: string;
  market: string;
};

type PositionCall = {
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

  const positionCalls: PositionCall[] = [];
  const positionPromises: Promise<unknown>[] = [];
  const userDebtMap = new Map<string, boolean>();

  for (const { account } of chunk) {
    userDebtMap.set(account, false);
  }

  for (const [index, result] of accountResults.entries()) {
    if (!accountCalls[index]) continue;

    const { account, market } = accountCalls[index];
    if (result.status === "rejected") {
      if (result.reason instanceof ContractFunctionExecutionError) continue;
      captureException(result.reason, { extra: { account, market } });
      continue;
    }
    const [fixedBorrows] = result.value as [bigint, bigint, bigint];
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
      const [principal] = result.value as [bigint, bigint];
      if (principal > 0n) {
        userDebtMap.set(account, true);
      }
    }
  }

  const users = [...userDebtMap.entries()].map(([account, hasDebt]) => ({
    account,
    hasDebt,
  }));

  return { contractCalls, users };
}

let maturityWorker: undefined | Worker;
let isInitializing = false;

export function initializeWorker(): void {
  if (maturityWorker || isInitializing) return;
  isInitializing = true;

  try {
    maturityWorker = new Worker(QUEUE_NAME, processor, { connection: redis });
  } catch (error) {
    isInitializing = false;
    captureException(error, { level: "error", tags: { queue: QUEUE_NAME, phase: "initialization" } });
    return;
  }
  isInitializing = false;

  maturityWorker
    .on("failed", (job: Job<CheckDebtsData> | undefined, error: Error) => {
      captureException(error, { extra: { job: job?.data } });
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
  isInitializing = false;
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
