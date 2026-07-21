import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function queue(redis: Redis) {
  const instance = createQueue<Job>(name, attempts, redis);
  return {
    close: () => instance.close(),
    async enqueue(account: Job["account"]) {
      await instance.enqueue({ account }, account);
    },
  };
}
