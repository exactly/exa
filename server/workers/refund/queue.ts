import { captureException } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function queue(bullmq: Redis) {
  const instance = createQueue<Job>(name, attempts, bullmq);
  return {
    close: () => instance.close(),
    async enqueue(amount: bigint, id: string) {
      try {
        await instance.enqueue({ amount: String(amount) as `${bigint}` }, id);
      } catch (error) {
        captureException(error, {
          level: "error",
          tags: { queue: name, job: name },
          extra: { amount: String(amount), id },
        });
      }
    },
  };
}

export async function enqueue(amount: bigint, id: string) {
  if (!singleton) throw new Error("refund queue is not started");
  await singleton.enqueue(amount, id);
}

export function start(bullmq: Redis) {
  singleton ??= queue(bullmq);
}

export async function close() {
  try {
    await singleton?.close();
  } finally {
    singleton = undefined;
  }
}

let singleton: ReturnType<typeof queue> | undefined;
