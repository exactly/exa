import { captureException, startSpan } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import { webhookId } from "../../utils/activityWebhook";
import createQueue from "../queue";

import type createAlchemy from "../../utils/alchemy";
import type { Address } from "@exactly/common/validation";
import type { Redis } from "ioredis";

export default function queue(redis: Redis, alchemy: ReturnType<typeof createAlchemy>) {
  const instance = createQueue<Job>(name, attempts, redis);
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
          const failure = new AggregateError([error, error_], "account subscription failed");
          captureException(failure, {
            level: "error",
            tags: { queue: name, job: name, fallback: "failed" },
            extra: { account },
          });
          throw failure;
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
