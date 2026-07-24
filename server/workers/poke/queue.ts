import { captureException } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export async function enqueue({ account, assets, chainId, factory, origin, publicKey, source }: Request) {
  if (!singleton) throw new Error("poke queue is not started");
  try {
    await singleton.enqueue(
      { account, assets, chainId, factory, origin, publicKey, source },
      [account, ...(assets ?? [])].join("-"),
      "account poke",
    );
  } catch (error) {
    captureException(error, {
      level: "error",
      tags: { queue: name, job: name },
      extra: { account },
    });
    throw error;
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

type Request = Omit<Job, "sentryBaggage" | "sentryTrace">;
