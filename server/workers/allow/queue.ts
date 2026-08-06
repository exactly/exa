import { captureException } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Address, Hex } from "@exactly/common/validation";
import type { Redis } from "ioredis";

export default function queue(bullmq: Redis) {
  const instance = createQueue<Job>(name, attempts, bullmq);
  return {
    close: () => instance.close(),
    async enqueue({ account, assets, chainId, factory, publicKey, source }: Request) {
      try {
        await instance.enqueue({ account, assets, chainId, factory, publicKey, source }, account, "account allow");
      } catch (error) {
        captureException(error, { level: "error", tags: { queue: name, job: name }, extra: { account } });
        throw error;
      }
    },
  };
}

export async function enqueue(request: Request) {
  if (!singleton) throw new Error("allow queue is not started");
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

type Request = {
  account: Address;
  assets?: Address[];
  chainId: number;
  factory: Address;
  publicKey: Hex;
  source: null | string;
};
