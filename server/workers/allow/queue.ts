import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function queue(bullmq: Redis) {
  const instance = createQueue<Job>(name, attempts, bullmq);
  return {
    close: () => instance.close(),
    async enqueue({
      account,
      assets,
      chainId,
      factory,
      publicKey,
      source,
    }: Omit<Job, "sentryBaggage" | "sentryTrace">) {
      await instance.enqueue({ account, assets, chainId, factory, publicKey, source }, account);
    },
  };
}
