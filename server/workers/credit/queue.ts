import { captureException } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export async function enqueue(account: Job["account"]) {
  if (!singleton) throw new Error("credit queue is not started");
  try {
    await singleton.enqueue({ account }, account);
  } catch (error) {
    captureException(error, {
      level: "error",
      tags: { queue: name, job: name },
      extra: { account },
    });
  }
}

export function start(bullmq: Redis) {
  singleton ??= createQueue<Job>(name, attempts, bullmq);
}

export async function close() {
  try {
    await singleton?.close();
  } finally {
    singleton = undefined;
  }
}

let singleton: ReturnType<typeof createQueue<Job>> | undefined;
