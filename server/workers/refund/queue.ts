import { captureException, spanToBaggageHeader, spanToTraceHeader, startSpan } from "@sentry/node";
import { Queue } from "bullmq";

import { attempts, name, type Job } from "./job";
import { queue as connection } from "../../utils/redis";

export async function enqueue(amount: bigint, id: string) {
  try {
    await startSpan({ name, op: "queue.publish", attributes: { "messaging.destination.name": name } }, async (span) => {
      const job = await queue.add(
        name,
        {
          amount: String(amount) as `${bigint}`,
          sentryBaggage: spanToBaggageHeader(span),
          sentryTrace: spanToTraceHeader(span),
        },
        { jobId: id },
      );
      span.setAttribute("messaging.message.id", job.id);
      span.setAttribute("messaging.message.body.size", Buffer.byteLength(JSON.stringify(job.data)));
    });
  } catch (error) {
    captureException(error, {
      level: "error",
      tags: { queue: name, job: name },
      extra: { amount: String(amount), id },
    });
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
