import { captureException } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function queue(bullmq: Redis) {
  const instance = createQueue<Job>(name, attempts, bullmq);
  return {
    close: () => instance.close(),
    async enqueue({ account, assets, chainId, factory, origin, publicKey, source }: Request) {
      try {
        await instance.enqueue(
          { account, assets, chainId, factory, origin, publicKey, source },
          [account, ...(assets ?? [])].join("-"),
          "account poke",
        );
      } catch (error) {
        captureException(error, { level: "error", tags: { queue: name, job: name }, extra: { account } });
        throw error;
      }
    },
  };
}

export async function enqueue(request: Request) {
  if (!singleton) throw new Error("poke queue is not started");
  await singleton.enqueue(request);
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

type Request = Omit<Job, "sentryBaggage" | "sentryTrace">;
