import { attempts, name, type Job, type Proposal, type Withdraw } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";
import type { InferOutput } from "valibot";

export default function queue(bullmq: Redis) {
  const instance = createQueue<Job>(name, attempts, bullmq);
  return {
    close: () => instance.close(),
    async enqueue(message: InferOutput<typeof Proposal> | InferOutput<typeof Withdraw>, minDelay = 0) {
      const delay = Math.max(minDelay, (Number(message.unlock) + 10) * 1000 - Date.now());
      if ("nonce" in message) {
        const { account, amount, data, market, nonce, proposalType, retryCount, timestamp, unlock } = message;
        await instance.enqueue(
          {
            account,
            amount: String(amount),
            data,
            market,
            nonce: String(nonce),
            proposalType,
            retryCount,
            timestamp,
            unlock: String(unlock),
          },
          [account, nonce, retryCount].join("-"),
          "schedule proposal",
          delay,
        );
        return;
      }
      const { account, amount, market, receiver, retryCount, timestamp, unlock } = message;
      await instance.enqueue(
        { account, amount: String(amount), market, receiver, retryCount, timestamp, unlock: String(unlock) },
        [account, market, unlock].join("-"),
        "schedule withdraw",
        delay,
      );
    },
  };
}
