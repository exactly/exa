import { captureException, withScope } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import { webhookId } from "../../utils/activityWebhook";
import createWorker from "../worker";

import type createAlchemy from "../../utils/alchemy";
import type { Redis } from "ioredis";

export default function worker({ alchemy, bullmq }: { alchemy: ReturnType<typeof createAlchemy>; bullmq: Redis }) {
  return createWorker<Job>({
    attempts,
    bullmq,
    failed(job, error) {
      withScope((scope) => {
        if (job) scope.setUser({ id: job.data.account });
        captureException(error, {
          level: "error",
          tags: { queue: name, job: job?.name },
          extra: { account: job?.data.account, attempts: job?.attemptsMade, id: job?.id },
        });
      });
    },
    name,
    async process(job) {
      await alchemy.addWebhookAddresses(webhookId, [job.data.account]);
    },
  });
}
