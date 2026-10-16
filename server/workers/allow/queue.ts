import { concatHex, keccak256 } from "viem";

import { attempts, name, type Batch, type Job } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function queue(redis: Redis) {
  const instance = createQueue<Batch | Job>(name, attempts, redis);
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
    async backfill(chainId: number, accounts: Batch["accounts"], priority: number) {
      await instance.bulk(
        Array.from({ length: Math.ceil(accounts.length / 100) }, (_, index) =>
          accounts.slice(index * 100, (index + 1) * 100),
        ).map((batch) => ({
          data: {
            accounts: batch.map(({ account, assets, factory, publicKey, source }) => ({
              account,
              assets,
              factory,
              publicKey,
              source,
            })),
            chainId,
          },
          id: [chainId, keccak256(concatHex(batch.map(({ account }) => account)))].join("-"),
        })),
        priority,
      );
    },
  };
}
