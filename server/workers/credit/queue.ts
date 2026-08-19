import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { DefaultJobOptions } from "bullmq";
import type { Redis } from "ioredis";

export default function queue(bullmq: Redis, removeOnComplete: DefaultJobOptions["removeOnComplete"] = true) {
  const instance = createQueue<Job>(name, attempts, bullmq, { removeOnComplete });
  return {
    close: () => instance.close(),
    async enqueue(account: Job["account"], jobId: string = account) {
      await instance.enqueue({ account }, jobId);
    },
  };
}
