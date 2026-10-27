import { spanToBaggageHeader, spanToTraceHeader, startSpan } from "@sentry/node";
import { Queue, type BackoffOptions, type DefaultJobOptions, type JobsOptions } from "bullmq";

import type { Redis } from "ioredis";

export default function queue<Job extends Trace>(
  name: string,
  attempts: number,
  redis: Redis,
  defaults: Partial<Omit<DefaultJobOptions, "backoff">> & { backoff?: Partial<BackoffOptions> } = {},
) {
  const instance = new Queue<Trace, void>(name, {
    connection: redis,
    defaultJobOptions: {
      attempts,
      removeOnComplete: true,
      removeOnFail: true,
      ...defaults,
      backoff: { type: "exponential", delay: 1000, ...defaults.backoff },
    },
  });
  return {
    close: () => instance.close(),
    async enqueue(data: Omit<Job, keyof Trace>, options: JobsOptions, spanName: string = name) {
      await startSpan(
        { name: spanName, op: "queue.publish", attributes: { "messaging.destination.name": name } },
        async (span) => {
          const job = await instance.add(
            name,
            { ...data, sentryBaggage: spanToBaggageHeader(span), sentryTrace: spanToTraceHeader(span) },
            options,
          );
          span.setAttribute("messaging.message.id", job.id);
          span.setAttribute("messaging.message.body.size", Buffer.byteLength(JSON.stringify(job.data)));
        },
      );
    },
  };
}

type Trace = {
  sentryBaggage?: string;
  sentryTrace?: string;
};
