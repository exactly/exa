import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function chat(bullmq: Redis) {
  const queue = createQueue<Job>(name, attempts, bullmq);
  return {
    close: () => queue.close(),
    enqueue: ({ id, ...data }: Omit<Job, "sentryBaggage" | "sentryTrace"> & { id: string }) => queue.enqueue(data, id),
  };
}
