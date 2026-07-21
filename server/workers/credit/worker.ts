import { createConfiguration, DefaultApi } from "@onesignal/node-onesignal";
import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import { captureException, close as closeSentry, continueTrace, startSpan, withScope } from "@sentry/node";
import { Worker } from "bullmq";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Redis } from "ioredis";

import { marketUSDCAddress, previewerAbi, previewerAddress } from "@exactly/common/generated/chain";

import { attempts, name, type Job } from "./job";
import * as schema from "../../database/schema";
import { cards, credentials } from "../../database/schema";
import t from "../../i18n";
import { sendPushNotification } from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import secret from "../../utils/secret";

let connection: Redis | undefined;
let database: ReturnType<typeof drizzle<typeof schema>> | undefined;
let worker: undefined | Worker<Job, void, "credit">;

export function start({
  onesignalKey,
  postgresUrl,
  redisUrl,
}: {
  onesignalKey: string;
  postgresUrl: string;
  redisUrl: string;
}) {
  if (worker) return worker;
  database ??= drizzle(postgresUrl, { schema });
  connection ??= new Redis(redisUrl, { maxRetriesPerRequest: null });
  const db = database;
  const onesignal = new DefaultApi(createConfiguration({ restApiKey: onesignalKey }));
  worker = new Worker<Job, void, "credit">(
    name,
    (job) => {
      const run = () =>
        startSpan({ name: `${job.name} worker`, forceTransaction: true }, (parent) =>
          startSpan(
            {
              attributes: {
                "messaging.destination.name": name,
                "messaging.message.body.size": Buffer.byteLength(JSON.stringify(job.data)),
                "messaging.message.id": job.id,
                "messaging.message.receive.latency": Date.now() - job.timestamp,
                "messaging.message.retry.count": job.attemptsMade,
              },
              name: job.name,
              op: "queue.process",
            },
            async (span) => {
              try {
                const markets = await publicClient.readContract({
                  address: previewerAddress,
                  functionName: "exactly",
                  abi: previewerAbi,
                  args: [job.data.account],
                });
                let auto = false;
                for (const { floatingDepositAssets, market } of markets) {
                  if (floatingDepositAssets <= 0n) continue;
                  if (market === marketUSDCAddress) {
                    auto = false;
                    break;
                  }
                  auto = true;
                }
                span.setAttribute("exa.autoCredit", auto);
                if (auto) {
                  const credential = await db.query.credentials.findFirst({
                    where: eq(credentials.account, job.data.account),
                    columns: {},
                    with: {
                      cards: {
                        columns: { id: true, mode: true },
                        where: inArray(cards.status, ["ACTIVE", "FROZEN"]),
                      },
                    },
                  });
                  const card = credential?.cards[0];
                  span.setAttribute("exa.card", card?.id);
                  if (card?.mode === 0) {
                    await db.update(cards).set({ mode: 1 }).where(eq(cards.id, card.id));
                    span.setAttribute("exa.mode", 1);
                    await sendPushNotification(
                      {
                        userId: job.data.account,
                        headings: t("Credit mode activated"),
                        contents: t("Your card is now in credit mode"),
                      },
                      onesignal,
                    ).catch((error: unknown) => captureException(error));
                  }
                }
                span.setStatus({ code: SPAN_STATUS_OK });
                parent.setStatus({ code: SPAN_STATUS_OK });
              } catch (error: unknown) {
                const status = {
                  code: SPAN_STATUS_ERROR,
                  message: error instanceof Error ? error.message : "queue process failed",
                } as const;
                span.setStatus(status);
                parent.setStatus(status);
                throw error;
              }
            },
          ),
        );
      return job.data.sentryTrace || job.data.sentryBaggage
        ? continueTrace({ sentryTrace: job.data.sentryTrace, baggage: job.data.sentryBaggage }, run)
        : run();
    },
    { connection, limiter: { max: 10, duration: 1000 } },
  )
    .on("failed", (job, error) => {
      if (job && job.attemptsMade < (job.opts.attempts ?? attempts)) return;
      withScope((scope) => {
        if (job) scope.setUser({ id: job.data.account });
        captureException(error, {
          extra: { account: job?.data.account, attempts: job?.attemptsMade, id: job?.id },
          level: "error",
          tags: { queue: name, job: job?.name },
        });
      });
    })
    .on("error", (error) => {
      captureException(error, { level: "error", tags: { queue: name } });
    });
  return worker;
}

async function main() {
  const [onesignalKey, postgresUrl, redisUrl] = await Promise.all([
    secret("credit-onesignal-api-key"),
    secret("credit-postgres-url"),
    secret("redis-url"),
  ]);
  return start({ onesignalKey, postgresUrl, redisUrl }).waitUntilReady();
}

const ready = process.env.VITEST ? undefined : main();
ready?.catch((error: unknown) => {
  captureException(error, { level: "fatal", tags: { startup: true, worker: name } });
  process.exitCode = 1;
  return close().catch((error_: unknown) => {
    captureException(error_, { level: "fatal", tags: { close: true, worker: name } });
  });
});

export async function close() {
  await ready?.catch(() => undefined);
  const results = await Promise.allSettled([
    closeSentry(),
    Promise.resolve(database?.$client.end()).then(() => {
      database = undefined;
    }),
    Promise.resolve(worker?.close())
      .then(() => {
        worker = undefined;
      })
      .finally(async () => {
        await connection?.quit();
        connection = undefined;
      }),
  ]);
  if (results.some((result) => result.status === "rejected")) throw new Error("closing services failed");
}

if (!process.env.VITEST) {
  ["SIGINT", "SIGTERM"].map((code) => {
    process.on(code, () => {
      close()
        .then(() => process.exit(0)) // eslint-disable-line n/no-process-exit
        .catch(() => process.exit(1)); // eslint-disable-line n/no-process-exit
    });
  });
}
