import { Redis } from "ioredis";

if (!process.env.REDIS_URL) throw new Error("missing redis url");

export default new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });

export const requestRedis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
