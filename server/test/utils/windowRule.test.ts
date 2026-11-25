// cspell:ignore dedup sismember sadd srem zrange zscore
import "../mocks/sentry";

import { captureException } from "@sentry/core";
import { serialize } from "@wagmi/core";
import { Queue, QueueEvents } from "bullmq";
import { object, string } from "valibot";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { close, queue as redis } from "../../utils/redis";
import windowRule from "../../utils/windowRule";

afterAll(async () => {
  await cleanup();
  await queueEvents.close();
  await close();
});

describe("windowRule", () => {
  const rules: { stop: () => Promise<void> }[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(rules.map((r) => r.stop()));
    rules.length = 0;
    await cleanup();
  });

  const schema = object({ amount: string(), id: string(), partition: string() });
  const window = 30 * 24 * 60 * 60 * 1000;

  function create(overrides?: {
    onEventExpire?: (partition: string, event: { amount: string; id: string; partition: string }) => Promise<void>;
    onTrigger?: (partition: string, result: { total: bigint; trigger: boolean }) => Promise<void>;
    onTriggerExpire?: (partition: string) => Promise<void>;
  }) {
    const rule = windowRule(
      {
        name: "test",
        schema,
        window,
        throttle,
        backoffDelay: 10,
        partition: (event) => event.partition,
        eventId: (event) => event.id,
        evaluate: (events) => {
          const total = events.reduce((sum, event) => sum + BigInt(Math.ceil(Number(event.amount) * 100)), 0n);
          return { trigger: total >= 300_000n, total };
        },
        ...overrides,
      },
      redis,
    );
    rules.push(rule);
    return rule;
  }

  describe("report", () => {
    it("stores event in sorted set", async () => {
      const rule = create();
      const event = { amount: "100", id: "evt_1", partition: "p1" };
      await rule.report(event, new Date());
      await processed();

      await expect(redis.zscore("wr:test:p1", member(event))).resolves.not.toBeNull();
    });

    it("is idempotent — duplicate eventId does not double-count", async () => {
      const rule = create();
      const now = new Date();
      const event = { amount: "1500", id: "evt_dup", partition: "p1" };
      await rule.report(event, now);
      await rule.report(event, now);
      await processed();

      await expect(redis.zrange("wr:test:p1", 0, -1)).resolves.toStrictEqual([member(event)]);
    });

    it("deduplicates report jobs by eventId", async () => {
      const rule = create();
      const now = new Date();
      const event = { amount: "100", id: "evt_dedup", partition: "p1" };
      await rule.report(event, now);
      await rule.report(event, now);
      await settled();

      await expect(rule.read("p1")).resolves.toStrictEqual({
        result: { trigger: false, total: 10_000n },
        triggered: false,
      });
      await expect(redis.zrange("wr:test:p1", 0, -1)).resolves.toHaveLength(1);

      const queue = new Queue("wr-test", { connection: redis });
      try {
        await expect(queue.getJob("test-expire-p1-evt_dedup")).resolves.toBeDefined();
      } finally {
        await queue.close();
      }
    });

    it("deduplicates report jobs by eventId even with different payload", async () => {
      const rule = create();
      const now = new Date();
      await rule.report({ amount: "100", id: "evt_same", partition: "p1" }, now);
      await rule.report({ amount: "999", id: "evt_same", partition: "p1" }, now);
      await settled();

      await expect(rule.read("p1")).resolves.toStrictEqual({
        result: { trigger: false, total: 10_000n },
        triggered: false,
      });
      await expect(redis.zrange("wr:test:p1", 0, -1)).resolves.toStrictEqual([
        member({ amount: "100", id: "evt_same", partition: "p1" }),
      ]);

      const queue = new Queue("wr-test", { connection: redis });
      try {
        await expect(queue.getJob("test-expire-p1-evt_same")).resolves.toBeDefined();
      } finally {
        await queue.close();
      }
    });

    it("triggers when threshold crossed", async () => {
      const onTrigger = vi
        .fn<(partition: string, result: { total: bigint; trigger: boolean }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onTrigger });
      const now = new Date();
      await rule.report({ amount: "2000", id: "evt_a", partition: "p1" }, now);
      await rule.report({ amount: "1000", id: "evt_b", partition: "p1" }, now);
      await settled();

      await expect(rule.read("p1")).resolves.toStrictEqual({
        result: { trigger: true, total: 300_000n },
        triggered: true,
      });
      expect(onTrigger).toHaveBeenCalled();
    });

    it("does not re-trigger on subsequent report", async () => {
      const onTrigger = vi
        .fn<(partition: string, result: { total: bigint; trigger: boolean }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onTrigger });
      const now = new Date();
      await rule.report({ amount: "3000", id: "evt_a", partition: "p1" }, now);
      await settled();
      onTrigger.mockClear();
      await rule.report({ amount: "100", id: "evt_b", partition: "p1" }, now);
      await settled();

      expect(onTrigger).not.toHaveBeenCalled();
    });

    it("calls onTrigger callback on first trigger only", async () => {
      const onTrigger = vi
        .fn<(partition: string, result: { total: bigint; trigger: boolean }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onTrigger });
      const now = new Date();
      await rule.report({ amount: "3000", id: "evt_a", partition: "p1" }, now);
      await settled();
      expect(onTrigger).toHaveBeenCalledExactlyOnceWith("p1", { trigger: true, total: 300_000n });

      onTrigger.mockClear();
      await rule.report({ amount: "100", id: "evt_b", partition: "p1" }, now);
      await settled();
      expect(onTrigger).not.toHaveBeenCalled();
    });

    it("schedules a delayed expire job", async () => {
      const rule = create();
      const now = new Date();
      const event = { amount: "100", id: "evt_j", partition: "p1" };
      await rule.report(event, now);
      await processed();

      const queue = new Queue("wr-test", { connection: redis });
      try {
        const job = await queue.getJob("test-expire-p1-evt_j");
        expect(job).toBeDefined();
        expect(job?.data).toStrictEqual({ member: member(event), partition: "p1" });
        expect(job?.opts.delay).toBeGreaterThan(0);
        expect(job?.opts.delay).toBeLessThanOrEqual(window);
      } finally {
        await queue.close();
      }
    });

    it("retries onTrigger when job fails", async () => {
      const onTrigger = vi
        .fn<(partition: string, result: { total: bigint }) => Promise<void>>()
        .mockRejectedValueOnce(new Error("hook failed"))
        .mockResolvedValue();
      const rule = create({ onTrigger });
      await rule.report({ amount: "3000", id: "evt_a", partition: "p1" }, new Date());
      await settled(500);

      expect(onTrigger).toHaveBeenCalledTimes(2);
      await expect(rule.read("p1")).resolves.toHaveProperty("triggered", true);
    });

    it("retries when redis.sadd fails", async () => {
      const onTrigger = vi
        .fn<(partition: string, result: { total: bigint; trigger: boolean }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onTrigger });
      const now = new Date();
      await rule.report({ amount: "2000", id: "evt_a", partition: "p1" }, now);
      await settled();
      expect(onTrigger).not.toHaveBeenCalled();

      vi.spyOn(redis, "sadd").mockRejectedValueOnce(new Error("redis error"));
      await rule.report({ amount: "1000", id: "evt_b", partition: "p1" }, now);
      await settled(500);

      expect(onTrigger).toHaveBeenCalledTimes(2);
      await expect(rule.read("p1")).resolves.toHaveProperty("triggered", true);
    });

    it("stops retrying onTrigger after exhausting attempts", async () => {
      const onTrigger = vi
        .fn<(partition: string, result: { total: bigint; trigger: boolean }) => Promise<void>>()
        .mockRejectedValue(new Error("hook always fails"));
      const rule = create({ onTrigger });
      await rule.report({ amount: "3000", id: "evt_a", partition: "p1" }, new Date());
      await settled(1000);

      expect(onTrigger).toHaveBeenCalledTimes(5);
      await expect(rule.read("p1")).resolves.toStrictEqual({
        result: { trigger: true, total: 300_000n },
        triggered: false,
      });
    });

    it("skips events older than window", async () => {
      const rule = create();
      const ancient = new Date(Date.now() - window - 60_000);
      const event = { amount: "3000", id: "evt_old", partition: "p1" };
      await rule.report(event, ancient);

      await expect(redis.zscore("wr:test:p1", member(event))).resolves.toBeNull();
    });

    it("worker skips stale event that expired while queued", async () => {
      create();
      const stale = Date.now() - window - 1000;
      const event = { amount: "3000", id: "evt_stale_worker", partition: "p1" };
      const queue = new Queue("wr-test", { connection: redis });
      await queue.add(
        "report",
        { eventId: event.id, member: member(event), partition: "p1", timestamp: stale },
        { jobId: "test-report-p1-evt_stale_worker" },
      );
      await queue.close();
      await settled();

      await expect(redis.zscore("wr:test:p1", member(event))).resolves.toBeNull();
    });

    it("cleans up orphaned member when stale retry finds prior partial insert", async () => {
      create();
      const stale = Date.now() - window - 1000;
      const event = { amount: "3000", id: "evt_orphan", partition: "p1" };
      await redis.zadd("wr:test:p1", stale, member(event));
      await expect(redis.zscore("wr:test:p1", member(event))).resolves.not.toBeNull();

      const queue = new Queue("wr-test", { connection: redis });
      await queue.add(
        "report",
        { eventId: event.id, member: member(event), partition: "p1", timestamp: stale },
        { jobId: "test-report-p1-evt_orphan" },
      );
      await queue.close();
      await settled();

      await expect(redis.zscore("wr:test:p1", member(event))).resolves.toBeNull();
    });

    it("cleanup on stale retry is a no-op when member was never inserted", async () => {
      create();
      const stale = Date.now() - window - 1000;
      const event = { amount: "3000", id: "evt_noop_cleanup", partition: "p1" };
      const queue = new Queue("wr-test", { connection: redis });
      await queue.add(
        "report",
        { eventId: event.id, member: member(event), partition: "p1", timestamp: stale },
        { jobId: "test-report-p1-evt_noop_cleanup" },
      );
      await queue.close();
      await settled();

      await expect(redis.zscore("wr:test:p1", member(event))).resolves.toBeNull();
    });

    it("delays report job for future-timestamped event", async () => {
      const rule = create();
      const skew = 500;
      const future = new Date(Date.now() + skew);
      const event = { amount: "3000", id: "evt_future", partition: "p1" };
      await rule.report(event, future);

      await expect(redis.zscore("wr:test:p1", member(event))).resolves.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, skew + 100));
      await settled();
      await expect(redis.zscore("wr:test:p1", member(event))).resolves.not.toBeNull();
    });

    it("triggers after future-timestamped event enters window", async () => {
      const onTrigger = vi
        .fn<(partition: string, result: { total: bigint; trigger: boolean }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onTrigger });
      const skew = 500;
      const future = new Date(Date.now() + skew);
      await rule.report({ amount: "3000", id: "evt_future", partition: "p1" }, future);
      expect(onTrigger).not.toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, skew + 100));
      await settled();
      expect(onTrigger).toHaveBeenCalledExactlyOnceWith("p1", { trigger: true, total: 300_000n });
    });

    it("preserves stale member score on duplicate report", async () => {
      const rule = create();
      const event = { amount: "3000", id: "evt_stale", partition: "p1" };
      await redis.zadd("wr:test:p1", 1, member(event));
      await rule.report(event, new Date());
      await processed();

      await expect(redis.zscore("wr:test:p1", member(event))).resolves.toBe("1");
    });

    it("adjusts delay for webhook latency when date is in the past", async () => {
      const rule = create();
      const past = new Date(Date.now() - 10_000);
      const event = { amount: "100", id: "evt_late", partition: "p1" };
      await rule.report(event, past);
      await processed();

      const queue = new Queue("wr-test", { connection: redis });
      try {
        const job = await queue.getJob("test-expire-p1-evt_late");
        expect(job).toBeDefined();
        expect(job?.opts.delay).toBeLessThanOrEqual(window - 10_000);
        expect(job?.opts.delay).toBeGreaterThan(0);
      } finally {
        await queue.close();
      }
    });

    it("sets delay close to window when date is now", async () => {
      const rule = create();
      const event = { amount: "100", id: "evt_now", partition: "p1" };
      await rule.report(event, new Date());
      await processed();

      const queue = new Queue("wr-test", { connection: redis });
      try {
        const job = await queue.getJob("test-expire-p1-evt_now");
        expect(job).toBeDefined();
        expect(job?.opts.delay).toBeGreaterThan(window - 1000);
        expect(job?.opts.delay).toBeLessThanOrEqual(window);
      } finally {
        await queue.close();
      }
    });

    it("propagates queue.add failure", async () => {
      const rule = create();
      vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(new Error("queue error"));
      await expect(rule.report({ amount: "100", id: "evt_q", partition: "p1" }, new Date())).rejects.toThrow(
        "queue error",
      );
    });

    it("throws on unknown job name", async () => {
      create();
      const queue = new Queue("wr-test", { connection: redis });
      try {
        const job = await queue.add("unknown", {}, { attempts: 1 });
        let state = await job.getState();
        while (state !== "completed" && state !== "failed") {
          await new Promise((resolve) => setTimeout(resolve, 10));
          state = await job.getState();
        }
        expect(state).toBe("failed");
      } finally {
        await queue.close();
      }
    });
  });

  describe("read", () => {
    it("returns result and triggered state for a partition", async () => {
      const rule = create();
      const now = new Date();
      await rule.report({ amount: "3000", id: "evt_a", partition: "p1" }, now);
      await settled();

      await expect(rule.read("p1")).resolves.toStrictEqual({
        result: { trigger: true, total: 300_000n },
        triggered: true,
      });
    });

    it("returns untriggered result when below threshold", async () => {
      const rule = create();
      await rule.report({ amount: "100", id: "evt_a", partition: "p1" }, new Date());
      await settled();

      await expect(rule.read("p1")).resolves.toStrictEqual({
        result: { trigger: false, total: 10_000n },
        triggered: false,
      });
    });

    it("returns untriggered result for empty partition", async () => {
      const rule = create();

      await expect(rule.read("p1")).resolves.toStrictEqual({ result: { trigger: false, total: 0n }, triggered: false });
    });

    it("reflects trigger state after expire resets trigger", async () => {
      const rule = create();
      const now = new Date();
      const event = { amount: "3000", id: "evt_a", partition: "p1" };
      await rule.report(event, now);
      await settled();
      await expect(rule.read("p1")).resolves.toHaveProperty("triggered", true);

      await expireEvent("p1", member(event));
      await settled();
      await expect(rule.read("p1")).resolves.toHaveProperty("triggered", false);
    });
  });

  describe("expire", () => {
    it("removes expired event from sorted set", async () => {
      create();
      const event = { amount: "100", id: "evt_1", partition: "p1" };
      await redis.zadd("wr:test:p1", Date.now(), member(event));
      await expireEvent("p1", member(event));
      await settled();

      await expect(redis.zscore("wr:test:p1", member(event))).resolves.toBeNull();
    });

    it("does not call onTriggerExpire if rule still satisfied", async () => {
      const onTriggerExpire = vi.fn<(partition: string) => Promise<void>>().mockResolvedValue();
      const rule = create({ onTriggerExpire });
      const now = new Date();
      await rule.report({ amount: "1000", id: "evt_a", partition: "p1" }, now);
      await rule.report({ amount: "3000", id: "evt_b", partition: "p1" }, now);
      await settled();
      const small = { amount: "1000", id: "evt_a", partition: "p1" };
      await expireEvent("p1", member(small));
      await settled();

      expect(onTriggerExpire).not.toHaveBeenCalled();
      await expect(redis.sismember("wr:test:triggered", "p1")).resolves.toBe(1);
    });

    it("calls onTriggerExpire when rule transitions from satisfied to unsatisfied", async () => {
      const onTriggerExpire = vi.fn<(partition: string) => Promise<void>>().mockResolvedValue();
      const rule = create({ onTriggerExpire });
      const now = new Date();
      const big = { amount: "3000", id: "evt_a", partition: "p1" };
      await rule.report(big, now);
      await rule.report({ amount: "100", id: "evt_b", partition: "p1" }, now);
      await settled();
      await expireEvent("p1", member(big));
      await settled();

      expect(onTriggerExpire).toHaveBeenCalledExactlyOnceWith("p1");
      await expect(redis.sismember("wr:test:triggered", "p1")).resolves.toBe(0);
    });

    it("does not call onTriggerExpire when partition was never triggered", async () => {
      const onTriggerExpire = vi.fn<(partition: string) => Promise<void>>().mockResolvedValue();
      const rule = create({ onTriggerExpire });
      const event = { amount: "100", id: "evt_a", partition: "p1" };
      await rule.report(event, new Date());
      await settled();
      await expireEvent("p1", member(event));
      await settled();

      expect(onTriggerExpire).not.toHaveBeenCalled();
    });

    it("does not eagerly delete key when no events remain", async () => {
      const del = vi.spyOn(redis, "del");
      const rule = create();
      const event = { amount: "100", id: "evt_a", partition: "p1" };
      await rule.report(event, new Date());
      await settled();
      await expireEvent("p1", member(event));
      await settled();

      expect(del).not.toHaveBeenCalled();
    });

    it("is idempotent — safe to call twice for same event", async () => {
      const onTriggerExpire = vi.fn<(partition: string) => Promise<void>>().mockResolvedValue();
      const rule = create({ onTriggerExpire });
      const event = { amount: "3000", id: "evt_a", partition: "p1" };
      await rule.report(event, new Date());
      await settled();
      await expireEvent("p1", member(event));
      await settled();
      expect(onTriggerExpire).toHaveBeenCalledExactlyOnceWith("p1");

      onTriggerExpire.mockClear();
      await expireEvent("p1", member(event));
      await settled();
      expect(onTriggerExpire).not.toHaveBeenCalled();
    });

    it("calls onEventExpire with the expired event", async () => {
      const onEventExpire = vi
        .fn<(partition: string, event: { amount: string; id: string; partition: string }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onEventExpire });
      const event = { amount: "100", id: "evt_a", partition: "p1" };
      await rule.report(event, new Date());
      await settled();
      await expireEvent("p1", member(event));

      expect(onEventExpire).toHaveBeenCalledExactlyOnceWith("p1", event);
    });

    it("calls onEventExpire even when rule is still satisfied", async () => {
      const onEventExpire = vi
        .fn<(partition: string, event: { amount: string; id: string; partition: string }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onEventExpire });
      const now = new Date();
      const small = { amount: "1000", id: "evt_a", partition: "p1" };
      await rule.report(small, new Date());
      await rule.report({ amount: "3000", id: "evt_b", partition: "p1" }, now);
      await settled();
      await expireEvent("p1", member(small));

      expect(onEventExpire).toHaveBeenCalledExactlyOnceWith("p1", small);
      await expect(redis.sismember("wr:test:triggered", "p1")).resolves.toBe(1);
    });

    it("retries onEventExpire when hook fails", async () => {
      const onEventExpire = vi
        .fn<(partition: string, event: { amount: string; id: string; partition: string }) => Promise<void>>()
        .mockRejectedValueOnce(new Error("hook failed"))
        .mockResolvedValue();
      const rule = create({ onEventExpire });
      const event = { amount: "100", id: "evt_a", partition: "p1" };
      await rule.report(event, new Date());
      await settled();

      await expect(expireEvent("p1", member(event))).rejects.toThrow("expire job failed");
      expect(onEventExpire).toHaveBeenCalledOnce();

      await expireEvent("p1", member(event));
      expect(onEventExpire).toHaveBeenCalledTimes(2);
    });

    it("removes corrupt member on expire without calling onEventExpire", async () => {
      const onEventExpire = vi
        .fn<(partition: string, event: { amount: string; id: string; partition: string }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onEventExpire });
      const corrupt = serialize({ wrong: "field" });
      await redis.zadd("wr:test:p1", Date.now(), corrupt);
      await expireEvent("p1", corrupt);
      await settled();

      await expect(redis.zscore("wr:test:p1", corrupt)).resolves.toBeNull();
      expect(onEventExpire).not.toHaveBeenCalled();
      const calls = captures("corrupt member in window");
      expect(calls.length).toBeGreaterThanOrEqual(1);

      const before = calls.length;
      await rule.read("p1");
      expect(captures("corrupt member in window")).toHaveLength(before);
    });

    it("expire retry does not call onTriggerExpire twice", async () => {
      const onTriggerExpire = vi.fn<(partition: string) => Promise<void>>().mockResolvedValue();
      const rule = create({ onTriggerExpire });
      const now = new Date();
      const big = { amount: "3000", id: "evt_a", partition: "p1" };
      const small = { amount: "100", id: "evt_b", partition: "p1" };
      await rule.report(big, now);
      await rule.report(small, now);
      await settled();
      await expireEvent("p1", member(big));
      await settled();
      expect(onTriggerExpire).toHaveBeenCalledExactlyOnceWith("p1");

      onTriggerExpire.mockClear();
      await expireEvent("p1", member(big));
      await settled();
      expect(onTriggerExpire).not.toHaveBeenCalled();

      await expect(redis.sismember("wr:test:triggered", "p1")).resolves.toBe(0);
    });

    it("expire retry preserves remaining events", async () => {
      const rule = create();
      const now = new Date();
      const big = { amount: "3000", id: "evt_a", partition: "p1" };
      const small = { amount: "100", id: "evt_b", partition: "p1" };
      await rule.report(big, now);
      await rule.report(small, now);
      await settled();
      await expireEvent("p1", member(big));
      await expireEvent("p1", member(big));
      await settled();

      await expect(redis.zrange("wr:test:p1", 0, -1)).resolves.toStrictEqual([member(small)]);
    });

    it("retries onTriggerExpire when hook fails", async () => {
      const onTriggerExpire = vi
        .fn<(partition: string) => Promise<void>>()
        .mockRejectedValueOnce(new Error("hook failed"))
        .mockResolvedValue();
      const rule = create({ onTriggerExpire });
      const event = { amount: "3000", id: "evt_a", partition: "p1" };
      await rule.report(event, new Date());
      await settled();

      await expireEvent("p1", member(event));
      await settled(500);

      expect(onTriggerExpire).toHaveBeenCalledTimes(2);
      await expect(redis.sismember("wr:test:triggered", "p1")).resolves.toBe(0);
    });

    it("retries onEventExpire when redis.zrem fails", async () => {
      const onEventExpire = vi
        .fn<(partition: string, event: { amount: string; id: string; partition: string }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onEventExpire });
      const event = { amount: "100", id: "evt_a", partition: "p1" };
      await rule.report(event, new Date());
      await settled();

      vi.spyOn(redis, "zrem").mockRejectedValueOnce(new Error("redis error"));
      await expect(expireEvent("p1", member(event))).rejects.toThrow("expire job failed");
      const callsBefore = onEventExpire.mock.calls.length;

      await expireEvent("p1", member(event));
      expect(onEventExpire).toHaveBeenCalledWith("p1", event);
      expect(onEventExpire.mock.calls.length).toBeGreaterThanOrEqual(callsBefore + 1);
      await expect(redis.zscore("wr:test:p1", member(event))).resolves.toBeNull();
    });

    it("retries check when redis.sismember fails in expire", async () => {
      const onTriggerExpire = vi.fn<(partition: string) => Promise<void>>().mockResolvedValue();
      const onEventExpire = vi
        .fn<(partition: string, event: { amount: string; id: string; partition: string }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onTriggerExpire, onEventExpire });
      const event = { amount: "3000", id: "evt_a", partition: "p1" };
      await rule.report(event, new Date());
      await settled();

      vi.spyOn(redis, "sismember").mockRejectedValueOnce(new Error("redis error"));
      await expireEvent("p1", member(event));
      await settled(500);

      expect(onTriggerExpire).toHaveBeenCalledExactlyOnceWith("p1");
      expect(onEventExpire).toHaveBeenCalledWith("p1", event);
      await expect(redis.sismember("wr:test:triggered", "p1")).resolves.toBe(0);
    });

    it("retries check when redis.srem fails", async () => {
      const onTriggerExpire = vi.fn<(partition: string) => Promise<void>>().mockResolvedValue();
      const rule = create({ onTriggerExpire });
      const event = { amount: "3000", id: "evt_a", partition: "p1" };
      await rule.report(event, new Date());
      await settled();

      vi.spyOn(redis, "srem").mockRejectedValueOnce(new Error("redis error"));
      await expireEvent("p1", member(event));
      await settled(500);

      expect(onTriggerExpire).toHaveBeenCalledTimes(2);
      await expect(redis.sismember("wr:test:triggered", "p1")).resolves.toBe(0);
    });
  });

  describe("serialization", () => {
    it("report enqueued before expire cannot race", async () => {
      const onTriggerExpire = vi.fn<(partition: string) => Promise<void>>();
      const rule = create({ onTriggerExpire });
      const now = new Date();
      const big = { amount: "3000", id: "evt_a", partition: "p1" };
      const small = { amount: "100", id: "evt_b", partition: "p1" };
      await rule.report(big, now);
      await rule.report(small, now);
      await settled();
      const added = { amount: "3000", id: "evt_c", partition: "p1" };
      onTriggerExpire.mockImplementation(async () => {
        await rule.report(added, now);
      });
      await expireEvent("p1", member(big));
      await settled();
      expect(onTriggerExpire).toHaveBeenCalledOnce();
      await new Promise((resolve) => setTimeout(resolve, throttle + 50));
      await rule.report({ amount: "0", id: "evt_noop", partition: "p1" }, now);
      await settled();
      await expect(rule.read("p1")).resolves.toStrictEqual({
        result: { trigger: true, total: 310_000n },
        triggered: true,
      });
    });

    it("expire evaluates after report and correctly resets trigger", async () => {
      const onTrigger = vi
        .fn<(partition: string, result: { total: bigint; trigger: boolean }) => Promise<void>>()
        .mockResolvedValue();
      const onTriggerExpire = vi.fn<(partition: string) => Promise<void>>().mockResolvedValue();
      const rule = create({ onTrigger, onTriggerExpire });
      const now = new Date();
      const old = { amount: "1500", id: "evt_b", partition: "p1" };
      const fresh = { amount: "2000", id: "evt_a", partition: "p1" };
      await rule.report(old, now);
      await rule.report(fresh, now);
      await settled();
      expect(onTrigger).toHaveBeenCalledOnce();
      await expireEvent("p1", member(old));
      await settled();
      expect(onTriggerExpire).toHaveBeenCalledOnce();
      await expect(rule.read("p1")).resolves.toStrictEqual({
        result: { trigger: false, total: 200_000n },
        triggered: false,
      });
    });

    it("triggers exactly once under concurrent reports", async () => {
      const onTrigger = vi
        .fn<(partition: string, result: { total: bigint; trigger: boolean }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onTrigger });
      const now = new Date();
      await Promise.all(
        Array.from({ length: 50 }, (_, index) =>
          rule.report({ amount: "1000", id: `evt_${index}`, partition: "p1" }, now),
        ),
      );
      await settled(2000);
      await expect(redis.zrange("wr:test:p1", 0, -1)).resolves.toHaveLength(50);
      expect(onTrigger).toHaveBeenCalledOnce();
    });

    it("handles multiple partitions concurrently", async () => {
      const onTrigger = vi
        .fn<(partition: string, result: { total: bigint; trigger: boolean }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onTrigger });
      const now = new Date();
      await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          rule.report({ amount: "3000", id: `evt_${index}`, partition: `p${index % 10}` }, now),
        ),
      );
      await settled(2000);
      const partitions = new Set(onTrigger.mock.calls.map(([p]) => p));
      expect(partitions).toStrictEqual(new Set(Array.from({ length: 10 }, (_, index) => `p${index}`)));
    });
  });

  describe("deduplication", () => {
    it("deduplicates check jobs for same partition within throttle window", async () => {
      const rule = create();
      const now = new Date();
      const sismemberSpy = vi.spyOn(redis, "sismember");
      for (let index = 0; index < 5; index++) {
        await rule.report({ amount: "100", id: `evt_dedup_${index}`, partition: "p1" }, now);
      }
      await settled(2000);
      expect(sismemberSpy.mock.calls.filter(([key]) => key === "wr:test:triggered")).toHaveLength(1);
    });

    it("does not deduplicate across partitions", async () => {
      const rule = create();
      const now = new Date();
      const sismemberSpy = vi.spyOn(redis, "sismember");
      await rule.report({ amount: "100", id: "evt_a", partition: "p1" }, now);
      await rule.report({ amount: "100", id: "evt_b", partition: "p2" }, now);
      await rule.report({ amount: "100", id: "evt_c", partition: "p3" }, now);
      await settled(2000);
      expect(sismemberSpy.mock.calls.filter(([key]) => key === "wr:test:triggered")).toHaveLength(3);
    });

    it("check sees all events reported within throttle window", async () => {
      const onTrigger = vi
        .fn<(partition: string, result: { total: bigint; trigger: boolean }) => Promise<void>>()
        .mockResolvedValue();
      const rule = create({ onTrigger });
      const now = new Date();
      await rule.report({ amount: "1500", id: "evt_a", partition: "p1" }, now);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await rule.report({ amount: "1500", id: "evt_b", partition: "p1" }, now);
      await settled(2000);

      expect(onTrigger).toHaveBeenCalledExactlyOnceWith("p1", { trigger: true, total: 300_000n });
    });

    it("creates new check job after deduplication window", async () => {
      const rule = create();
      const now = new Date();
      const sismemberSpy = vi.spyOn(redis, "sismember");
      await rule.report({ amount: "100", id: "evt_a", partition: "p1" }, now);
      await settled();
      expect(sismemberSpy.mock.calls.filter(([key]) => key === "wr:test:triggered")).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, throttle + 50));
      await rule.report({ amount: "100", id: "evt_b", partition: "p1" }, now);
      await settled();
      expect(sismemberSpy.mock.calls.filter(([key]) => key === "wr:test:triggered")).toHaveLength(2);
    });
  });

  describe("stress", () => {
    it("handles bulk sequential events correctly", async () => {
      const rule = create();
      const now = new Date();
      const count = 500;
      for (let index = 0; index < count; index++) {
        await rule.report({ amount: "1", id: `evt_${index}`, partition: "p1" }, now);
      }
      await settled(5000);
      await expect(redis.zrange("wr:test:p1", 0, -1)).resolves.toHaveLength(count);
    }, 30_000);
  });

  describe("sentry", () => {
    it("captures validation issues for invalid report job", async () => {
      create();
      const queue = new Queue("wr-test", { connection: redis });
      await queue.add("report", { bad: true }, { attempts: 1 });
      await queue.close();
      await settled();

      const calls = captures("invalid report job data");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toHaveProperty("level", "error");
      expect(calls[0]?.[1]).toHaveProperty("extra.job", { bad: true });
      expect(calls[0]?.[1]).toHaveProperty("extra.cause", [
        issue("eventId"),
        issue("member"),
        issue("partition"),
        issue("timestamp"),
      ]);
    });

    it("captures validation issues for invalid expire job", async () => {
      create();
      const queue = new Queue("wr-test", { connection: redis });
      await queue.add("expire", { bad: true }, { attempts: 1 });
      await queue.close();
      await settled();

      const calls = captures("invalid expire job data");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toHaveProperty("level", "error");
      expect(calls[0]?.[1]).toHaveProperty("extra.job", { bad: true });
      expect(calls[0]?.[1]).toHaveProperty("extra.cause", [issue("member"), issue("partition")]);
    });

    it("captures validation issues for invalid check job", async () => {
      create();
      const queue = new Queue("wr-test", { connection: redis });
      await queue.add("check", { bad: true }, { attempts: 1 });
      await queue.close();
      await settled();

      const calls = captures("invalid check job data");
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[1]).toHaveProperty("level", "error");
      expect(calls[0]?.[1]).toHaveProperty("extra.job", { bad: true });
      expect(calls[0]?.[1]).toHaveProperty("extra.cause", [issue("partition")]);
    });

    it("skips corrupt member and captures to sentry", async () => {
      const rule = create();
      const now = new Date();
      await rule.report({ amount: "100", id: "evt_valid", partition: "p1" }, now);
      await redis.zadd("wr:test:p1", Date.now(), serialize({ wrong: "field" }));
      await settled();

      await expect(rule.read("p1")).resolves.toHaveProperty("result", { trigger: false, total: 10_000n });

      const calls = captures("corrupt member in window");
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]?.[1]).toHaveProperty("extra.member", serialize({ wrong: "field" }));
      expect(calls[0]?.[1]).toHaveProperty("extra.issues", [issue("amount"), issue("id"), issue("partition")]);
    });
  });
});

vi.mock("@sentry/core", { spy: true });

function issue(key: string) {
  return expect.objectContaining({
    kind: "schema",
    type: "object",
    path: [expect.objectContaining({ key })],
  }) as object;
}

function captures(message: string) {
  return vi
    .mocked(captureException)
    .mock.calls.filter(([error]) => error instanceof Error && error.message === message);
}

function member(event: { amount: string; id: string; partition: string }) {
  return serialize(event);
}

async function cleanup() {
  const keys = await redis.keys("wr:test:*");
  if (keys.length > 0) await redis.del(...keys);
  const queue = new Queue("wr-test", { connection: redis });
  await queue.obliterate({ force: true });
  await queue.close();
}

async function expireEvent(partition: string, eventMember: string) {
  const queue = new Queue("wr-test", { connection: redis });
  try {
    const job = await queue.add("expire", { member: eventMember, partition });
    let state = await job.getState();
    while (state !== "completed" && state !== "failed") {
      await new Promise((resolve) => setTimeout(resolve, 10));
      state = await job.getState();
    }
    if (state === "failed") throw new Error(`expire job failed: ${job.failedReason}`);
  } finally {
    await queue.close();
  }
}

const throttle = 100;
const queueEvents = new QueueEvents("wr-test", { connection: redis });

function processed() {
  return new Promise<void>((resolve) => {
    const done = () => {
      queueEvents.off("completed", done);
      queueEvents.off("failed", done);
      resolve();
    };
    queueEvents.on("completed", done);
    queueEvents.on("failed", done);
  });
}

async function settled(silence = throttle * 2 + 50) {
  return new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout;
    const done = () => {
      queueEvents.off("completed", reset);
      queueEvents.off("failed", reset);
      resolve();
    };
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(done, silence);
    };
    queueEvents.on("completed", reset);
    queueEvents.on("failed", reset);
    reset();
  });
}
