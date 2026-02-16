import { Redis } from "ioredis";

if (!process.env.REDIS_URL) throw new Error("missing redis url");

const redis = new Redis(process.env.REDIS_URL);
export default redis;

export const queue = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

export async function close() {
  await Promise.all([queue.quit(), redis.quit()]);
}
