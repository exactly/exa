import RedisMemoryServer from "redis-memory-server";

import type { QueueBase, QueueEvents } from "bullmq";
import type { Redis } from "ioredis";
import type { EventEmitter } from "node:events";

export default async function setup() {
  const server = new RedisMemoryServer({ instance: { port: 8479 } });
  await server.start();

  return async function teardown() {
    await server.stop();
  };
}

export function finished(events: QueueEvents, id: string) {
  const emitter: EventEmitter = events;
  return new Promise<void>((resolve, reject) => {
    function completed() {
      emitter.off(`failed:${id}`, failed);
      resolve();
    }
    function failed({ failedReason }: { failedReason: string }) {
      emitter.off(`completed:${id}`, completed);
      reject(new Error(failedReason));
    }
    emitter.once(`completed:${id}`, completed).once(`failed:${id}`, failed);
  });
}

export async function tip(redis: Redis, queue: QueueBase) {
  const [[id] = ["0"]] = await redis.xrevrange(queue.toKey("events"), "+", "-", "COUNT", 1); // cspell:ignore xrevrange
  return id;
}
