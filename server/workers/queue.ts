import { spanToBaggageHeader, spanToTraceHeader, startSpan } from "@sentry/node";
import { Queue, type BackoffOptions, type DefaultJobOptions } from "bullmq";

import type { Redis } from "ioredis";

export default function queue<Job extends Trace>(
  name: string,
  attempts: number,
  redis: Redis,
  options: Partial<Omit<DefaultJobOptions, "backoff">> & { backoff?: Partial<BackoffOptions> } = {},
) {
  const instance = new Queue<Trace, void>(name, {
    connection: redis,
    defaultJobOptions: {
      attempts,
      removeOnComplete: true,
      removeOnFail: true,
      ...options,
      backoff: { type: "exponential", delay: 1000, ...options.backoff },
    },
  });
  return {
    close: () => instance.close(),
    async enqueue(data: Payload<Job>, jobId: string, spanName: string = name) {
      await startSpan(
        { name: spanName, op: "queue.publish", attributes: { "messaging.destination.name": name } },
        async (span) => {
          const job = await instance.add(
            name,
            { ...data, sentryBaggage: spanToBaggageHeader(span), sentryTrace: spanToTraceHeader(span) },
            { jobId },
          );
          span.setAttribute("messaging.message.id", job.id);
          span.setAttribute("messaging.message.body.size", Buffer.byteLength(JSON.stringify(job.data)));
        },
      );
    },
    async bulk(jobs: { data: Payload<Job>; id: string }[], priority?: number) {
      if (jobs.length === 0) return;
      await startSpan(
        {
          name,
          op: "queue.publish",
          attributes: { "messaging.destination.name": name, "messaging.batch.message_count": jobs.length },
        },
        async (span) => {
          for (let index = 0; index < jobs.length; index += 1000) {
            await instance.addBulk(
              jobs.slice(index, index + 1000).map(({ data, id }) => ({
                name,
                data: { ...data, sentryBaggage: spanToBaggageHeader(span), sentryTrace: spanToTraceHeader(span) },
                opts: { jobId: id, priority },
              })),
            );
          }
        },
      );
    },
  };
}

type Payload<Job> = Job extends Trace ? Omit<Job, keyof Trace> : never;

type Trace = {
  sentryBaggage?: string;
  sentryTrace?: string;
};
