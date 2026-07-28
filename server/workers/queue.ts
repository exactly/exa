import { spanToBaggageHeader, spanToTraceHeader, startSpan } from "@sentry/node";
import { Queue } from "bullmq";

import type { Redis } from "ioredis";

export default function queue<Job extends Trace>(name: string, attempts: number, bullmq: Redis) {
  const instance = new Queue<Trace, void>(name, {
    connection: bullmq,
    defaultJobOptions: {
      attempts,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: true,
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    },
  });
  return {
    close: () => instance.close(),
    async enqueue(data: Omit<Job, keyof Trace>, jobId: string, spanName: string = name) {
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
  };
}

type Trace = {
  sentryBaggage?: string;
  sentryTrace?: string;
};
