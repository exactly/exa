import { captureException } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function queue(bullmq: Redis) {
  const instance = createQueue<Job>(name, attempts, bullmq);
  return {
    close: () => instance.close(),
    async enqueue(account: Job["account"]) {
      try {
        await instance.enqueue({ account }, account);
      } catch (error) {
        captureException(error, { level: "error", tags: { queue: name, job: name }, extra: { account } });
      }
    },
  };
}
