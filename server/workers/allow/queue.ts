import { captureException } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import { bullmq } from "../../utils/redis";
import createQueue from "../queue";

import type { Address, Hex } from "@exactly/common/validation";

export async function enqueue({
  account,
  assets,
  chainId,
  factory,
  publicKey,
  source,
}: {
  account: Address;
  assets?: Address[];
  chainId: number;
  factory: Address;
  publicKey: Hex;
  source: null | string;
}) {
  try {
    await queue.enqueue({ account, assets, chainId, factory, publicKey, source }, account, "account allow");
  } catch (error) {
    captureException(error, {
      level: "error",
      tags: { queue: name, job: name },
      extra: { account },
    });
    throw error;
  }
}

export async function close() {
  await queue.close();
}

const queue = createQueue<Job>(name, attempts, bullmq);
