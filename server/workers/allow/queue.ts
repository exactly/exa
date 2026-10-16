import { attempts, name, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function queue(redis: Redis) {
  const instance = createQueue<Job>(name, attempts, redis);
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
      await instance.enqueue({ account, assets, chainId, factory, publicKey, source }, [chainId, account].join("-"));
    },
    async backfill(jobs: Omit<Job, "sentryBaggage" | "sentryTrace">[], priority: number) {
      await instance.bulk(
        jobs.map(({ account, assets, chainId, factory, publicKey, source }) => ({
          data: { account, assets, chainId, factory, publicKey, source },
          id: [chainId, account].join("-"),
        })),
        priority,
      );
    },
  };
}
