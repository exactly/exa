import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { DefaultJobOptions } from "bullmq";
import type { Redis } from "ioredis";

export default function queue(redis: Redis, removeOnComplete: DefaultJobOptions["removeOnComplete"] = true) {
  const instance = createQueue<Job>(name, attempts, redis, { removeOnComplete });
  return {
    close: () => instance.close(),
    async enqueue(account: Job["account"], jobId: string = account) {
      await instance.enqueue({ account }, jobId);
    },
  };
}
