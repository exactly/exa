import { attempts, name, type Job, type Proposal } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function queue(bullmq: Redis) {
  const instance = createQueue<Job>(name, attempts, bullmq);
  return {
    close: () => instance.close(),
    async enqueue(proposal: Proposal) {
      await instance.enqueue(
        {
          ...proposal,
          amount: String(proposal.amount),
          nonce: String(proposal.nonce),
          unlock: String(proposal.unlock),
        },
        `${proposal.account}-${String(proposal.nonce)}-${proposal.retryCount}`,
        "schedule proposal",
        { delay: Math.max(0, Number(proposal.unlock) * 1000 - Date.now()) },
      );
    },
  };
}
