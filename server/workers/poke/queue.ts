import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function queue(bullmq: Redis) {
  const instance = createQueue<Job>(name, attempts, bullmq, { backoff: { type: "fixed", delay: 2000 } });
  return {
    close: () => instance.close(),
    async enqueue({
      account,
      assets,
      chainId,
      factory,
      origin,
      publicKey,
      source,
    }: Omit<Job, "pending" | "sentryBaggage" | "sentryTrace">) {
      await instance.enqueue(
        { account, assets, chainId, factory, origin, publicKey, source },
        {
          deduplication: { id: [chainId, account, ...(assets ?? [])].join("-"), keepLastIfActive: true, replace: true },
        },
      );
    },
  };
}
