import { Redis } from "ioredis";
import { env } from "node:process";

if (!env.REDIS_URL) throw new Error("missing redis url");

const redis = new Redis(env.REDIS_URL);
export default redis;

export const bullmq = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export async function close() {
  await Promise.all([bullmq.quit(), redis.quit()]);
}
