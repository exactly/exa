import { addBreadcrumb, captureException, startSpan, type Span } from "@sentry/node";
import { Queue, Worker, type Job } from "bullmq";
import Redis from "ioredis";

import { headers } from "../utils/alchemy";
import { AlchemyJob, QueueName } from "./constants";

const ALCHEMY_WEBHOOK_URL = "https://dashboard.alchemy.com/api/update-webhook-addresses";
const SENTRY_SPAN_ERROR_CODE = 2;

export type AlchemyJobData = { account: string; webhookId: string };

let connection: Redis | undefined;

function getConnection(): Redis {
  if (!connection) {
    if (!process.env.REDIS_URL) throw new Error("REDIS_URL environment variable is not set");
    connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  }
  return connection;
}

let _alchemyQueue: Queue | undefined;

/**
 * bullmq queue for managing alchemy-related background tasks.
 * used primarily for offloading webhook subscription updates to avoid blocking the main thread
 * and to allow for retries on api failures.
 */
export function getAlchemyQueue(): Queue {
  _alchemyQueue ??= new Queue(QueueName.ALCHEMY, { connection: getConnection() });

  return _alchemyQueue;
}

/**
 * processor function for the alchemy worker.
 * handles 'add-subscriber' jobs by calling the alchemy api.
 *
 * @param job - the bullmq job containing the subscription details.
 */
export async function processor(job: Job<AlchemyJobData>) {
  return startSpan(
    { name: "alchemy.processor", op: "queue.process", attributes: { job: job.name, ...job.data } },
    async (span: Span) => {
      switch (job.name) {
        case AlchemyJob.ADD_SUBSCRIBER: {
          const { account, webhookId } = job.data;
          const response = await fetch(ALCHEMY_WEBHOOK_URL, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ webhook_id: webhookId, addresses_to_add: [account], addresses_to_remove: [] }),
          });
          if (!response.ok) {
            const text = await response.text();
            span.setStatus({ code: SENTRY_SPAN_ERROR_CODE, message: text });
            throw new Error(`${response.status} ${text}`);
          }
          break;
        }
        default: {
          const message = `Unknown job name: ${job.name}`;
          span.setStatus({ code: SENTRY_SPAN_ERROR_CODE, message });
          throw new Error(message);
        }
      }
    },
  );
}

let alchemyWorker: undefined | Worker;
let isInitializing = false;
let initPromise: Promise<void> | undefined;

/**
 * initializes the alchemy worker to process background jobs.
 * should be called once during server startup.
 */
export function initializeWorker(): void {
  if (alchemyWorker || isInitializing) return; // already initialized or initializing
  isInitializing = true;

  initPromise = (() => {
    try {
      alchemyWorker = new Worker(QueueName.ALCHEMY, processor, {
        connection: getConnection(),
        limiter: { max: 10, duration: 1000 },
      });
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      isInitializing = false;
    }
  })();

  initPromise
    .then(() => {
      alchemyWorker
        ?.on("failed", (job: Job<AlchemyJobData> | undefined, error: Error) => {
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
          captureException(error, { level: "error", tags: { queue: QueueName.ALCHEMY } });
        });
    })
    .catch((error: unknown) => {
      captureException(error, { level: "error", tags: { queue: QueueName.ALCHEMY, phase: "initialization" } });
    });
}

export async function close() {
  // wait for initialization to complete before closing
  if (initPromise) {
    await initPromise;
  }
  await Promise.all([alchemyWorker?.close() ?? Promise.resolve(), _alchemyQueue?.close() ?? Promise.resolve()]);
  await connection?.quit();
}
