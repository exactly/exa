import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import { captureException, close as closeSentry, continueTrace, startSpan, withScope } from "@sentry/node";
import { Worker } from "bullmq";
import { Redis } from "ioredis";

import { attempts, name, type Job } from "./job";
import { webhookId } from "../../utils/activityWebhook";
import { addWebhookAddresses } from "../../utils/alchemy";
import secret from "../../utils/secret";

let connection: Redis | undefined;
let worker: undefined | Worker<Job, void, typeof name>;

export function start({ alchemyKey, redisUrl }: { alchemyKey: string; redisUrl: string }) {
  if (worker) return worker;
  connection ??= new Redis(redisUrl, { maxRetriesPerRequest: null });
  worker = new Worker<Job, void, typeof name>(
    name,
    (job) => {
      const run = () =>
        startSpan({ name: `${name} worker`, forceTransaction: true }, (parent) =>
          startSpan(
            {
              name,
              op: "queue.process",
              attributes: {
                "messaging.destination.name": name,
                "messaging.message.id": job.id,
                "messaging.message.body.size": Buffer.byteLength(JSON.stringify(job.data)),
                "messaging.message.receive.latency": Date.now() - job.timestamp,
                "messaging.message.retry.count": job.attemptsMade,
              },
            },
            async (span) => {
              try {
                await addWebhookAddresses(webhookId, [job.data.account], alchemyKey);
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
          level: "error",
          tags: { queue: name, job: job?.name },
          extra: { account: job?.data.account, attempts: job?.attemptsMade, id: job?.id },
        });
      });
    })
    .on("error", (error) => {
      captureException(error, { level: "error", tags: { queue: name } });
    });
  return worker;
}

async function main() {
  const [alchemyKey, redisUrl] = await Promise.all([secret("account-alchemy-webhooks-key"), secret("redis-url")]);
  return start({ alchemyKey, redisUrl }).waitUntilReady();
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
