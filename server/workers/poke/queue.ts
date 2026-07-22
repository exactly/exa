import { captureException, spanToBaggageHeader, spanToTraceHeader, startSpan } from "@sentry/node";
import { Queue } from "bullmq";

import { attempts, name, type Job } from "./job";
import { queue as connection } from "../../utils/redis";

import type { Address, Hex } from "@exactly/common/validation";

export async function enqueue({
  account,
  assets,
  chainId,
  factory,
  origin,
  publicKey,
  source,
}: {
  account: Address;
  assets?: Address[];
  chainId: number;
  factory: Address;
  origin: "activity" | "allow";
  publicKey: Hex;
  source: null | string;
}) {
  try {
    await startSpan(
      { name: "account poke", op: "queue.publish", attributes: { "messaging.destination.name": name } },
      async (span) => {
        const job = await queue.add(
          name,
          {
            account,
            assets,
            chainId,
            factory,
            origin,
            publicKey,
            sentryBaggage: spanToBaggageHeader(span),
            sentryTrace: spanToTraceHeader(span),
            source,
          },
          { jobId: [account, ...(assets ?? [])].join("-") },
        );
        span.setAttribute("messaging.message.id", job.id);
        span.setAttribute("messaging.message.body.size", Buffer.byteLength(JSON.stringify(job.data)));
      },
    );
  } catch (error) {
    captureException(error, {
      level: "error",
      tags: { queue: name, job: name },
      extra: { account },
    });
    throw error;
  }
}

export async function close() {
  await queue.close();
}

const queue = new Queue<Job, void, typeof name>(name, {
  connection,
  defaultJobOptions: {
    attempts,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
  },
});
