import { SPAN_STATUS_ERROR } from "@sentry/core";
import { addBreadcrumb, captureException, startSpan, type Span } from "@sentry/node";
import { Queue, Worker, type Job } from "bullmq";

import { headers } from "../utils/alchemy";
import redis from "../utils/redis";

const QUEUE_NAME = "alchemy";

export const AlchemyJob = {
  ADD_SUBSCRIBER: "add-subscriber",
} as const;

export type AlchemyJobData = { account: string; webhookId: string };

let _alchemyQueue: Queue | undefined;

export function getAlchemyQueue(): Queue {
  _alchemyQueue ??= new Queue(QUEUE_NAME, { connection: redis });

  return _alchemyQueue;
}

export async function processor(job: Job<AlchemyJobData>) {
  return startSpan(
    { name: "alchemy.processor", op: "queue.process", attributes: { job: job.name, ...job.data } },
    async (span: Span) => {
      switch (job.name) {
        case AlchemyJob.ADD_SUBSCRIBER: {
          const { account, webhookId } = job.data;
          const response = await fetch("https://dashboard.alchemy.com/api/update-webhook-addresses", {
            method: "PATCH",
            headers,
            body: JSON.stringify({ webhook_id: webhookId, addresses_to_add: [account], addresses_to_remove: [] }),
          });
          if (!response.ok) {
            const text = await response.text();
            span.setStatus({ code: SPAN_STATUS_ERROR, message: text });
            throw new Error(`${response.status} ${text}`);
          }
          break;
        }
        default: {
          const message = `Unknown job name: ${job.name}`;
          span.setStatus({ code: SPAN_STATUS_ERROR, message });
          throw new Error(message);
        }
      }
    },
  );
}

let alchemyWorker: undefined | Worker;

export function initializeWorker(): void {
  if (alchemyWorker) return;

  try {
    alchemyWorker = new Worker(QUEUE_NAME, processor, {
      connection: redis,
      limiter: { max: 10, duration: 1000 },
    });
  } catch (error) {
    captureException(error, { level: "error", tags: { queue: QUEUE_NAME, phase: "initialization" } });
    return;
  }

  alchemyWorker
    .on("failed", (job: Job<AlchemyJobData> | undefined, error: Error) => {
      captureException(error, { level: "error", extra: { job: job?.data } });
    })
    .on("completed", (job: Job<AlchemyJobData>) => {
      addBreadcrumb({
        category: "queue",
        message: `Job ${job.id} completed`,
        level: "info",
        data: { job: job.data },
      });
    })
    .on("active", (job: Job<AlchemyJobData>) => {
      addBreadcrumb({
        category: "queue",
        message: `Job ${job.id} active`,
        level: "info",
        data: { job: job.data },
      });
    })
    .on("error", (error: Error) => {
      captureException(error, { level: "error", tags: { queue: QUEUE_NAME } });
    });
}

export async function close() {
  await Promise.all([alchemyWorker?.close() ?? Promise.resolve(), _alchemyQueue?.close() ?? Promise.resolve()]);
  alchemyWorker = undefined;
  _alchemyQueue = undefined;
}
