import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import { captureException, close as closeSentry, continueTrace, startSpan, withScope } from "@sentry/node";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { parse } from "valibot";

import { firewallAbi, firewallAddress } from "@exactly/common/generated/chain";
import stack from "@exactly/common/stack";
import { Address } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import secret from "../../utils/secret";
import { getWallet } from "../../utils/wallet";
import { enqueue as enqueuePoke } from "../poke/queue";

let connection: Redis | undefined;
let worker: undefined | Worker<Job, void, "allow">;

export function start({ redisUrl }: { redisUrl: string }) {
  if (worker) return worker;
  connection ??= new Redis(redisUrl, { maxRetriesPerRequest: null });
  worker = new Worker<Job, void, "allow">(
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
                const wallet = await getWallet(`${stack}-allower`);
                await wallet.exaSend(
                  { name: "firewall.allow", op: "exa.firewall", attributes: { account: job.data.account } },
                  {
                    address: parse(Address, firewallAddress),
                    functionName: "allow",
                    args: [job.data.account, true],
                    abi: firewallAbi,
                  },
                  { ignore: [`AlreadyAllowed(${job.data.account})`] },
                );
                const { account, assets, chainId, factory, publicKey, source } = job.data;
                await enqueuePoke({ account, assets, chainId, factory, origin: "allow", publicKey, source });
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
  return secret("redis-url").then((redisUrl) => start({ redisUrl }).waitUntilReady());
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
