import { captureException, withScope } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import { webhookId } from "../../utils/activityWebhook";
import createAlchemy from "../../utils/alchemy";
import createWorker, { connect } from "../worker";

export default function worker({ alchemyKey, redisUrl }: { alchemyKey: string; redisUrl: string }) {
  const alchemy = createAlchemy(alchemyKey);
  return createWorker<Job>({
    attempts,
    bullmq: connect(redisUrl),
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
