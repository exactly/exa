import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function queue(redis: Redis) {
  const instance = createQueue<Job>(name, attempts, redis, { backoff: { delay: 500 } });
  return {
    close: () => instance.close(),
    ready: () => instance.ready(),
    enqueue: (data: Omit<Job, "sentryBaggage" | "sentryTrace">, id: string) => instance.enqueue(data, id),
  };
}
