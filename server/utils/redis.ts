import { Redis } from "ioredis";

if (!process.env.REDIS_URL) throw new Error("missing redis url");

const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

export default redis;

export const requestRedis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });

export async function closeRedis() {
  await Promise.all([redis.quit(), requestRedis.quit()]);
}
