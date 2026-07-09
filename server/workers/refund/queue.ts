import { captureException } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import { bullmq } from "../../utils/redis";
import createQueue from "../queue";

export async function enqueue(amount: bigint, id: string) {
  try {
    await queue.enqueue({ amount: String(amount) as `${bigint}` }, id);
  } catch (error) {
    captureException(error, {
      level: "error",
      tags: { queue: name, job: name },
      extra: { amount: String(amount), id },
    });
  }
}

export async function close() {
  await queue.close();
}

const queue = createQueue<Job>(name, attempts, bullmq);
