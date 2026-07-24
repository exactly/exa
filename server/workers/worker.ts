import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import { captureException, continueTrace, startSpan } from "@sentry/node";
import { Worker } from "bullmq";
import { Redis } from "ioredis";

import type { Span } from "@sentry/core";
import type * as BullMQ from "bullmq";

export default function worker<Job extends { sentryBaggage?: string; sentryTrace?: string }>({
  attempts,
  bullmq,
  close,
  failed,
  name,
  process,
}: {
  attempts: number;
  bullmq: Redis;
  close?: () => Promise<unknown>;
  failed: (job: BullMQ.Job<Job> | undefined, error: Error) => void;
  name: string;
  process: (job: BullMQ.Job<Job>, span: Span) => Promise<void>;
}) {
  const queue = new Worker<Job, void>(
    name,
    (job) => {
      const callback = () =>
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
                await process(job, span);
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
        ? continueTrace({ sentryTrace: job.data.sentryTrace, baggage: job.data.sentryBaggage }, callback)
        : callback();
    },
    { connection: bullmq, limiter: { max: 10, duration: 1000 } },
  )
    .on("failed", (job, error) => {
      if (job && job.attemptsMade < (job.opts.attempts ?? attempts)) return;
      failed(job, error);
    })
    .on("error", (error) => {
      captureException(error, { level: "error", tags: { queue: name } });
    });
  let closing: Promise<unknown> | undefined;
  return {
    close: () =>
      (closing ??= queue
        .close()
        .finally(() => close?.())
        .finally(() => bullmq.quit())),
    queue,
    ready: queue.waitUntilReady(),
  };
}

export function connect(redisUrl: string) {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}
