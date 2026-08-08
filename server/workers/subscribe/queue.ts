import { captureException, startSpan } from "@sentry/node";
import { parse, string } from "valibot";

import { attempts, name, type Job } from "./job";
import { webhookId } from "../../utils/activityWebhook";
import createAlchemy from "../../utils/alchemy";
import { bullmq } from "../../utils/redis";
import createQueue from "../queue";

import type { Address } from "@exactly/common/validation";

export async function enqueue(account: Address) {
  try {
    await queue.enqueue({ account }, account);
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
}

export async function close() {
  await queue.close();
}

const queue = createQueue<Job>(name, attempts, bullmq);
const alchemy = createAlchemy(parse(string(), process.env.ALCHEMY_WEBHOOKS_KEY));
