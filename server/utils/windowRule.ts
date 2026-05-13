// cspell:ignore sismember sadd srem zrangebyscore zscore
import { addBreadcrumb, captureException, startSpan } from "@sentry/core";
import { deserialize, serialize } from "@wagmi/core";
import { Queue, UnrecoverableError, Worker } from "bullmq";
import { isValiError, number, object, safeParse, string } from "valibot";

import type { Job } from "bullmq";
import type { Redis } from "ioredis";
import type { BaseIssue, BaseSchema, InferOutput } from "valibot";

export default function windowRule<
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TResult extends { trigger: boolean },
>(
  config: {
    backoffDelay?: number;
    evaluate: (events: InferOutput<TSchema>[]) => TResult;
    eventId: (event: InferOutput<TSchema>) => string;
    name: string;
    onEventExpire?: (partition: string, event: InferOutput<TSchema>) => Promise<unknown>;
    onTrigger?: (partition: string, result: TResult) => Promise<unknown>;
    onTriggerExpire?: (partition: string) => Promise<unknown>;
    partition: (event: InferOutput<TSchema>) => string;
    schema: TSchema;
    throttle?: number;
    window: number;
  },
  redis: Redis,
) {
  const { name, schema, window, evaluate, onTrigger, onTriggerExpire, onEventExpire } = config;
  const queueName = `wr-${name}`;
  const triggeredKey = `wr:${name}:triggered`;
  const jobOptions = {
    attempts: 5,
    backoff: { delay: config.backoffDelay ?? 1000, type: "exponential" as const },
    removeOnComplete: true,
    removeOnFail: true,
  };

  const queue = new Queue<unknown, unknown, "check" | "expire" | "report">(queueName, {
    connection: redis,
    defaultJobOptions: jobOptions,
  });
  const worker = new Worker<unknown, unknown, "check" | "expire" | "report">(
    queueName,
    async (job) =>
      startSpan(
        {
          name: `wr:${name}:${job.name}`,
          op: "queue.process",
          forceTransaction: true,
          attributes: {
            "job.id": job.id ?? "",
            "job.attempts": job.attemptsMade,
            ...(job.failedReason ? { "job.failedReason": job.failedReason } : {}),
          },
        },
        async (span) => {
          switch (job.name) {
            case "report": {
              const result = safeParse(
                object({ eventId: string(), member: string(), partition: string(), timestamp: number() }),
                job.data,
              );
              if (!result.success)
                throw Object.assign(new UnrecoverableError("invalid report job data"), { cause: result.issues });
              const { member, partition, timestamp, eventId } = result.output;
              span.setAttributes({ partition, eventId });
              const now = Date.now();
              if (now - timestamp > window) {
                await redis.zrem(getKey(partition), member);
                break;
              }
              const delay = window - (now - timestamp);
              await Promise.all([
                redis.zadd(getKey(partition), "NX", timestamp, member),
                queue.add("expire", { member, partition }, { delay, jobId: `${name}-expire-${partition}-${eventId}` }),
                addCheck(partition),
              ]);
              break;
            }
            case "expire": {
              const result = safeParse(object({ member: string(), partition: string() }), job.data);
              if (!result.success)
                throw Object.assign(new UnrecoverableError("invalid expire job data"), { cause: result.issues });
              const { member, partition } = result.output;
              span.setAttribute("partition", partition);
              const deserialized = safeParse(schema, deserialize(member));
              if (!deserialized.success)
                captureException(new Error("corrupt member in window"), {
                  extra: { member, issues: deserialized.issues },
                });
              await Promise.all([
                redis.zrem(getKey(partition), member),
                deserialized.success && onEventExpire ? onEventExpire(partition, deserialized.output) : undefined,
                addCheck(partition),
              ]);
              break;
            }
            case "check": {
              const result = safeParse(object({ partition: string() }), job.data);
              if (!result.success)
                throw Object.assign(new UnrecoverableError("invalid check job data"), { cause: result.issues });
              span.setAttribute("partition", result.output.partition);
              await check(result.output.partition);
              break;
            }
            default: {
              const exhaustive: never = job.name;
              throw new UnrecoverableError(`unknown job: ${exhaustive as string}`);
            }
          }
        },
      ),
    { connection: redis, concurrency: 1 },
  );
  worker
    .on("failed", (job: Job<unknown> | undefined, error: Error) => {
      captureException(error, {
        level: "error",
        extra: {
          job: job?.data,
          ...(error.cause === undefined ? {} : { cause: isValiError(error.cause) ? error.cause.issues : error.cause }),
        },
      });
    })
    .on("completed", (job: Job<unknown>) => {
      addBreadcrumb({ category: "queue", message: `Job ${job.id} completed`, level: "info", data: { job: job.data } });
    })
    .on("active", (job: Job<unknown>) => {
      addBreadcrumb({ category: "queue", message: `Job ${job.id} active`, level: "info", data: { job: job.data } });
    })
    .on("error", (error: Error) => {
      captureException(error, { level: "error", tags: { queue: queueName } });
    });

  function getKey(partition: string) {
    return `wr:${name}:${partition}`;
  }

  function addCheck(partition: string) {
    const throttle = config.throttle ?? 1000;
    return queue.add("check", { partition }, { delay: throttle, deduplication: { id: partition, ttl: throttle } });
  }

  function deserializeMembers(members: string[]) {
    return members.flatMap((member) => {
      const result = safeParse(schema, deserialize(member));
      if (result.success) return [result.output];
      captureException(new Error("corrupt member in window"), { extra: { member, issues: result.issues } });
      return [];
    });
  }

  async function check(partition: string) {
    return startSpan({ name: `wr:${name}:evaluate`, op: "function", attributes: { partition } }, async (span) => {
      const key = getKey(partition);
      const timestamp = Date.now();
      const [events, wasTriggered] = await Promise.all([
        redis.zrangebyscore(key, timestamp - window, timestamp).then(deserializeMembers),
        redis.sismember(triggeredKey, partition).then((v) => v === 1),
      ]);
      const result = evaluate(events);
      span.setAttributes({ events: events.length, trigger: result.trigger, wasTriggered });
      if (result.trigger === wasTriggered) return;
      if (result.trigger) {
        if (onTrigger) await onTrigger(partition, result);
        await redis.sadd(triggeredKey, partition);
      } else {
        if (onTriggerExpire) await onTriggerExpire(partition);
        await redis.srem(triggeredKey, partition);
      }
    });
  }

  return {
    async read(partition: string) {
      const key = getKey(partition);
      const timestamp = Date.now();
      const [events, triggered] = await Promise.all([
        redis.zrangebyscore(key, timestamp - window, timestamp).then(deserializeMembers),
        redis.sismember(triggeredKey, partition).then((exists) => exists === 1),
      ]);
      return { result: evaluate(events), triggered };
    },
    async report(event: InferOutput<TSchema>, date: Date) {
      const partition = config.partition(event);
      const member = serialize(event);
      const timestamp = date.getTime();
      if (Date.now() - timestamp > window) return;
      const eventId = config.eventId(event);
      await queue.add(
        "report",
        { eventId, member, partition, timestamp },
        { delay: Math.max(0, timestamp - Date.now()), jobId: `${name}-report-${partition}-${eventId}` },
      );
    },
    async stop() {
      await worker.waitUntilReady();
      await Promise.all([worker.close(), queue.close()]);
    },
  };
}
