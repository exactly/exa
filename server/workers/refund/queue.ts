import { captureException } from "@sentry/node";

import { attempts, name, type Job } from "./job";
import { bullmq } from "../../utils/redis";
import createQueue from "../queue";

export async function enqueue(id: string) {
  try {
    await queue.enqueue({}, id);
  } catch (error) {
    captureException(error, { level: "error", tags: { queue: name, job: name }, extra: { id } });
  }
}

export async function close() {
  await queue.close();
}

const queue = createQueue<Job>(name, attempts, bullmq);
