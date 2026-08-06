import { captureException, startSpan } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import { webhookId } from "../../utils/activityWebhook";
import createQueue from "../queue";

import type createAlchemy from "../../utils/alchemy";
import type { Address } from "@exactly/common/validation";
import type { Redis } from "ioredis";

export default function queue(bullmq: Redis, alchemy: ReturnType<typeof createAlchemy>) {
  const instance = createQueue<Job>(name, attempts, bullmq);
  return {
    close: () => instance.close(),
    async enqueue(account: Address) {
      try {
        await instance.enqueue({ account }, account);
      } catch (error) {
        try {
          await startSpan({ name: `${name} fallback`, op: "queue.recover", attributes: { account } }, () =>
            alchemy.addWebhookAddresses(webhookId, [account]),
          );
        } catch (error_) {
          captureException(new AggregateError([error, error_], "account subscription failed"), {
            level: "error",
            tags: { queue: name, job: name, fallback: "failed" },
            extra: { account },
          });
          return;
        }
        captureException(error, {
          level: "warning",
          tags: { queue: name, job: name, fallback: "succeeded" },
          extra: { account },
        });
      }
    },
  };
}

export async function enqueue(account: Address) {
  if (!singleton) throw new Error("subscribe queue is not started");
  await singleton.enqueue(account);
}

export function start(bullmq: Redis, alchemy: ReturnType<typeof createAlchemy>) {
  singleton ??= queue(bullmq, alchemy);
}

export async function close() {
  try {
    await singleton?.close();
  } finally {
    singleton = undefined;
  }
}

let singleton: ReturnType<typeof queue> | undefined;
