import { captureException, spanToBaggageHeader, spanToTraceHeader, startSpan } from "@sentry/node";
import { Queue } from "bullmq";

import { attempts, name, type Job } from "./job";
import { webhookId } from "../../utils/activityWebhook";
import { addWebhookAddresses } from "../../utils/alchemy";
import { queue as connection } from "../../utils/redis";

import type { Address } from "@exactly/common/validation";

export { name } from "./job";

export async function enqueue(account: Address) {
  try {
    await startSpan({ name, op: "queue.publish", attributes: { "messaging.destination.name": name } }, async (span) => {
      const job = await queue.add(
        name,
        { account, sentryBaggage: spanToBaggageHeader(span), sentryTrace: spanToTraceHeader(span) },
        { jobId: account },
      );
      span.setAttribute("messaging.message.id", job.id);
      span.setAttribute("messaging.message.body.size", Buffer.byteLength(JSON.stringify(job.data)));
    });
  } catch (error) {
    try {
      await startSpan({ name: `${name} fallback`, op: "queue.recover", attributes: { account } }, () =>
        addWebhookAddresses(webhookId, [account]),
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

const queue = new Queue<Job, void, typeof name>(name, {
  connection,
  defaultJobOptions: {
    attempts,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: true,
    removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
  },
});
