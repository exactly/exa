import { addBreadcrumb, captureException, startSpan, type Span } from "@sentry/node";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

import { AlchemyJob, QueueName } from "./constants";
import { headers } from "../utils/alchemy";

/**
 * Interface representing the data payload for Alchemy background jobs.
 */
export interface AlchemyJobData {
  /** The likely Ethereum address of the account to subscribe. */
  account: string;
  /** The Alchemy webhook ID to update. */
  webhookId: string;
}

const connection = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : {
      host: process.env.REDIS_HOST ?? "localhost",
      port: Number(process.env.REDIS_PORT ?? 6379),
    };

/**
 * BullMQ Queue for managing Alchemy-related background tasks.
 * Used primarily for offloading webhook subscription updates to avoid blocking the main thread
 * and to allow for retries on API failures.
 */
export const alchemyQueue = new Queue(QueueName.ALCHEMY, { connection });

/**
 * Processor function for the Alchemy worker.
 * Handles 'add-subscriber' jobs by calling the Alchemy API.
 *
 * @param job - The BullMQ job containing the subscription details.
 */
export const processor = async (job: Job<AlchemyJobData>) => {
  return startSpan(
    { name: "alchemy.processor", op: "queue.process", attributes: { job: job.name, ...job.data } },
    async (span: Span) => {
      if (job.name === AlchemyJob.ADD_SUBSCRIBER) {
        const { account, webhookId: hookId } = job.data;
        const response = await fetch("https://dashboard.alchemy.com/api/update-webhook-addresses", {
          method: "PATCH",
          headers,
          body: JSON.stringify({ webhook_id: hookId, addresses_to_add: [account], addresses_to_remove: [] }),
        });
        if (!response.ok) {
          const text = await response.text();
          span.setStatus({ code: 2, message: text });
          throw new Error(`${response.status} ${text}`);
        }
      }
    },
  );
};

// This logic here is to prevent certain build code from trying
// to initialize the worker and Redis
if (process.env.DISABLE_WORKERS !== "true") {
  new Worker(QueueName.ALCHEMY, processor, {
    connection,
    limiter: { max: 10, duration: 1000 },
    // cspell:ignore autorun
    autorun: true,
  })
    .on("failed", (job, error: Error) => {
      captureException(error, { extra: { job: job?.data } });
    })
    .on("completed", (job) => {
      addBreadcrumb({
        category: "queue",
        message: `Job ${job.id} completed`,
        level: "info",
        data: { job: job.data },
      });
    })
    .on("active", (job) => {
      addBreadcrumb({
        category: "queue",
        message: `Job ${job.id} active`,
        level: "info",
        data: { job: job.data },
      });
    });
}
