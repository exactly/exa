import { spanToBaggageHeader, spanToTraceHeader, startSpan } from "@sentry/node";
import { Queue, type BackoffOptions, type DefaultJobOptions, type JobsOptions, type KeepJobs } from "bullmq";

import type { Redis } from "ioredis";

export default function queue<Job extends Trace>(
  name: string,
  attempts: number,
  bullmq: Redis,
  options: Partial<Omit<DefaultJobOptions, "backoff" | "removeOnFail">> & {
    backoff?: Partial<BackoffOptions>;
    removeOnFail?: Partial<KeepJobs>;
  } = {},
) {
  const instance = new Queue<Trace, void>(name, {
    connection: bullmq,
    defaultJobOptions: {
      attempts,
      removeOnComplete: true,
      ...options,
      backoff: { type: "exponential", delay: 1000, ...options.backoff },
      removeOnFail: { count: 1000, age: 7 * 24 * 3600, ...options.removeOnFail },
    },
  });
  return {
    close: () => instance.close(),
    async enqueue(
      data: Omit<Job, keyof Trace>,
      jobId: string,
      spanName: string = name,
      jobOptions: Omit<JobsOptions, "jobId"> = {},
    ) {
      await startSpan(
        { name: spanName, op: "queue.publish", attributes: { "messaging.destination.name": name } },
        async (span) => {
          const job = await instance.add(
            name,
            { ...data, sentryBaggage: spanToBaggageHeader(span), sentryTrace: spanToTraceHeader(span) },
            { jobId, ...jobOptions },
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
