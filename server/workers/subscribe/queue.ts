import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Address } from "@exactly/common/validation";
import type { Redis } from "ioredis";

export default function queue(redis: Redis) {
  const instance = createQueue<Job>(name, attempts, redis);
  return {
    close: () => instance.close(),
    enqueue: (account: Address) => instance.enqueue({ account }, account),
  };
}
