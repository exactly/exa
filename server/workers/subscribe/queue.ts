import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Address } from "@exactly/common/validation";
import type { Redis } from "ioredis";

export default function queue(bullmq: Redis) {
  const instance = createQueue<Job>(name, attempts, bullmq);
  return {
    close: () => instance.close(),
    enqueue: (account: Address) => instance.enqueue({ account }, account),
  };
}
