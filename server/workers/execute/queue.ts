import { attempts, name, type Job, type Proposal } from "./job";
import createQueue from "../queue";

import type { Redis } from "ioredis";

export default function queue(bullmq: Redis) {
  const instance = createQueue<Job>(name, attempts, bullmq);
  return {
    close: () => instance.close(),
    async enqueue(proposal: Proposal) {
      const serialized: Job =
        proposal.functionName === "executeProposal"
          ? {
              ...proposal,
              amount: String(proposal.amount),
              nonce: String(proposal.nonce),
              unlock: String(proposal.unlock),
            }
          : { ...proposal, amount: String(proposal.amount), unlock: String(proposal.unlock) };
      await instance.enqueue(
        serialized,
        `${serialized.account}-${
          serialized.functionName === "executeProposal"
            ? serialized.nonce
            : `${serialized.market}-${serialized.receiver}-${serialized.amount}-${
                serialized.timestamp ?? Math.floor(Date.now() / 1000)
              }`
        }-${serialized.retryCount}`,
        "schedule proposal",
        { delay: Math.max(0, Number(serialized.unlock) * 1000 - Date.now()) },
      );
    },
  };
}
