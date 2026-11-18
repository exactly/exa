/// <reference types="vite/client" />
import "../mocks/sentry";

import { captureException, getActiveSpan, getIsolationScope, setUser, spanToJSON } from "@sentry/node";
import { Job, Queue, QueueEvents, UnrecoverableError } from "bullmq";
import { argv, env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";

import worker, { connect } from "../../workers/worker";
import { finished, tip } from "../redis";

const workers = Object.entries(import.meta.glob<{ default: unknown }>("../../workers/*/worker.ts"));
const length = argv.length;
const redisUrl = parse(pipe(string(), nonEmpty()), env.REDIS_URL);

afterAll(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  argv.splice(length);
});

beforeAll(() => {
  vi.resetModules();
  for (const name of Object.keys(env)) vi.stubEnv(name, undefined); // eslint-disable-line unicorn/no-useless-undefined
});

describe("worker", () => {
  it("discovers workers", () => {
    expect(workers.length).toBeGreaterThan(0);
  });

  it.each(workers)("%s loads without environment variables", async (_, load) => {
    await expect(load().then(({ default: loaded }) => loaded)).resolves.toBeTypeOf("function");
  });

  it("starts in production mode", async () => {
    const process = vi.fn(() => Promise.resolve());
    const bullmq = connect(redisUrl);
    const handle = worker({
      attempts: 1,
      bullmq,
      failed: vi.fn(),
      name: "worker-production",
      process,
    });

    await handle.ready;

    expect(handle.check).toBe(false);
    expect(handle.queue.isRunning()).toBe(true);
    expect(process).not.toHaveBeenCalled();
    await expect(handle.close()).resolves.toBeUndefined();
    await bullmq.quit();
  });

  it("composes custom readiness", async () => {
    const ready = Promise.withResolvers<boolean>();
    const bullmq = connect(redisUrl);
    const handle = worker({
      attempts: 1,
      bullmq,
      failed: vi.fn(),
      name: `worker-${crypto.randomUUID()}`,
      process: vi.fn(() => Promise.resolve()),
      ready: ready.promise,
    });
    expectTypeOf<Awaited<typeof handle.ready>[1]>().toEqualTypeOf<boolean | undefined>();

    try {
      await handle.queue.waitUntilReady();
      await expect(Promise.race([handle.ready.then(() => "ready"), Promise.resolve("pending")])).resolves.toBe(
        "pending",
      );
      ready.resolve(true);
      await expect(handle.ready).resolves.toBeDefined();
    } finally {
      await handle.close();
      await bullmq.quit();
    }
  });

  it("captures errors once ready", async () => {
    vi.mocked(captureException).mockClear();
    const name = `worker-${crypto.randomUUID()}`;
    const bullmq = connect(redisUrl);
    const handle = worker({ attempts: 1, bullmq, failed: vi.fn(), name, process: vi.fn(() => Promise.resolve()) });
    const timeout = new Error("connect ETIMEDOUT");
    const lost = new Error("connection lost");

    try {
      handle.queue.emit("error", timeout);
      await handle.ready;
      handle.queue.emit("error", lost);
      expect(captureException).toHaveBeenCalledExactlyOnceWith(lost, { level: "error", tags: { queue: name } });
    } finally {
      await handle.close();
      await bullmq.quit();
    }
  });

  it("reports the last error when closed before ready", async () => {
    argv.push("--check");
    vi.mocked(captureException).mockClear();
    const name = `worker-${crypto.randomUUID()}`;
    const bullmq = connect(redisUrl);
    const handle = worker({ attempts: 1, bullmq, failed: vi.fn(), name, process: vi.fn(() => Promise.resolve()) });
    handle.ready.catch(() => undefined);
    const last = new Error("connect ETIMEDOUT");

    try {
      handle.queue.emit("error", new Error("connect ETIMEDOUT"));
      handle.queue.emit("error", last);
      expect(captureException).not.toHaveBeenCalled();
    } finally {
      await handle.close();
      await bullmq.quit();
    }
    expect(captureException).toHaveBeenCalledExactlyOnceWith(last, { level: "error", tags: { queue: name } });
  });

  it("reports the last error when not ready by the deadline", async () => {
    vi.mocked(captureException).mockClear();
    const name = `worker-${crypto.randomUUID()}`;
    const bullmq = connect(redisUrl);
    const last = new Error("connect ETIMEDOUT");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const handle = worker({ attempts: 1, bullmq, failed: vi.fn(), name, process: vi.fn(() => Promise.resolve()) });

    try {
      handle.queue.emit("error", new Error("connect ETIMEDOUT"));
      handle.queue.emit("error", last);
      vi.advanceTimersByTime(119_999);
      expect(captureException).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(captureException).toHaveBeenCalledExactlyOnceWith(last, { level: "error", tags: { queue: name } });
    } finally {
      vi.useRealTimers();
      await handle.ready;
      await handle.close();
      await bullmq.quit();
    }
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("reports errors while closing before ready", async () => {
    argv.push("--check");
    vi.mocked(captureException).mockClear();
    const name = `worker-${crypto.randomUUID()}`;
    const bullmq = connect(redisUrl);
    const handle = worker({ attempts: 1, bullmq, failed: vi.fn(), name, process: vi.fn(() => Promise.resolve()) });
    handle.ready.catch(() => undefined);
    const timeout = new Error("connect ETIMEDOUT");
    const cleanup = new Error("close failed");
    const close = handle.queue.close.bind(handle.queue);
    vi.spyOn(handle.queue, "close").mockImplementationOnce(() => {
      handle.queue.emit("error", cleanup);
      return close();
    });

    try {
      handle.queue.emit("error", timeout);
    } finally {
      await handle.close();
      await bullmq.quit();
    }
    expect(vi.mocked(captureException).mock.calls).toStrictEqual([
      [timeout, { level: "error", tags: { queue: name } }],
      [cleanup, { level: "error", tags: { queue: name } }],
    ]);
  });

  it("reports a stall without errors by the deadline", async () => {
    vi.mocked(captureException).mockClear();
    const name = `worker-${crypto.randomUUID()}`;
    const bullmq = connect(redisUrl);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const handle = worker({ attempts: 1, bullmq, failed: vi.fn(), name, process: vi.fn(() => Promise.resolve()) });

    try {
      vi.advanceTimersByTime(120_000);
      expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error(`${name} worker not ready`), {
        level: "error",
        tags: { queue: name },
      });
    } finally {
      vi.useRealTimers();
      await handle.ready;
      await handle.close();
      await bullmq.quit();
    }
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("skips the deadline once ready", async () => {
    vi.mocked(captureException).mockClear();
    const name = `worker-${crypto.randomUUID()}`;
    const bullmq = connect(redisUrl);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const handle = worker({ attempts: 1, bullmq, failed: vi.fn(), name, process: vi.fn(() => Promise.resolve()) });

    try {
      handle.queue.emit("error", new Error("connect ETIMEDOUT"));
      await handle.ready;
      vi.advanceTimersByTime(120_000);
      expect(captureException).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      await handle.close();
      await bullmq.quit();
    }
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports exhausted jobs inside the job trace", async () => {
    const name = `worker-${crypto.randomUUID()}`;
    const redis = connect(redisUrl);
    const queue = new Queue(name, { connection: redis });
    const events = new QueueEvents(name, { connection: connect(redisUrl), lastEventId: await tip(redis, queue) });
    const error = new Error("exhausted");
    const process = vi.fn(() => {
      setUser({ id: "exhausted" });
      return Promise.reject(error);
    });
    const failures: unknown[] = [];
    const failed = vi.fn((job: Job | undefined) => {
      const span = getActiveSpan();
      failures.push({
        attempts: job?.attemptsMade,
        span: span && spanToJSON(span),
        user: getIsolationScope().getUser(),
      });
    });
    const bullmq = connect(redisUrl);
    const handle = worker({ attempts: 1, bullmq, failed, name, process });

    try {
      await Promise.all([handle.ready, events.waitUntilReady()]);
      const result = finished(events, "exhausted");
      await queue.add(
        "exhaust",
        { sentryTrace: "0123456789abcdef0123456789abcdef-0123456789abcdef-1" },
        { attempts: 2, backoff: { type: "fixed", delay: 1 }, jobId: "exhausted", removeOnFail: true },
      );
      await expect(result).rejects.toThrow("exhausted");
      expect(process).toHaveBeenCalledTimes(2);
      await vi.waitFor(() => {
        expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "exhausted" }), error);
      });
      expect(failures).toStrictEqual([
        {
          attempts: 2,
          span: expect.objectContaining({
            description: "exhaust",
            op: "queue.process",
            status: "exhausted",
            trace_id: "0123456789abcdef0123456789abcdef", // cspell:ignore abcdef
          }) as unknown,
          user: { id: "exhausted" },
        },
      ]);
      expect(getIsolationScope().getUser()).toStrictEqual({});
    } finally {
      await handle.close();
      await bullmq.quit();
      await events.close();
      await queue.close();
      await redis.quit();
    }
  });

  it("reports unrecoverable jobs on the first attempt", async () => {
    const name = `worker-${crypto.randomUUID()}`;
    const redis = connect(redisUrl);
    const queue = new Queue(name, { connection: redis });
    const events = new QueueEvents(name, { connection: connect(redisUrl), lastEventId: await tip(redis, queue) });
    const error = new UnrecoverableError("unrecoverable");
    const process = vi.fn(() => Promise.reject(error));
    const failures: unknown[] = [];
    const failed = vi.fn((job: Job | undefined) => {
      const span = getActiveSpan();
      failures.push({ attempts: job?.attemptsMade, span: span && spanToJSON(span) });
    });
    const bullmq = connect(redisUrl);
    const handle = worker({ attempts: 3, bullmq, failed, name, process });

    try {
      await Promise.all([handle.ready, events.waitUntilReady()]);
      const result = finished(events, "unrecoverable");
      await queue.add("unrecoverable", {}, { attempts: 3, jobId: "unrecoverable", removeOnFail: true });
      await expect(result).rejects.toThrow("unrecoverable");
      expect(process).toHaveBeenCalledOnce();
      await vi.waitFor(() => {
        expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "unrecoverable" }), error);
      });
      expect(failures).toStrictEqual([
        {
          attempts: 1,
          span: expect.objectContaining({
            description: "unrecoverable",
            op: "queue.process",
            status: "unrecoverable",
          }) as unknown,
        },
      ]);
    } finally {
      await handle.close();
      await bullmq.quit();
      await events.close();
      await queue.close();
      await redis.quit();
    }
  });

  it("reports failures outside the processor", async () => {
    const name = `worker-${crypto.randomUUID()}`;
    const failed = vi.fn();
    const bullmq = connect(redisUrl);
    const handle = worker({ attempts: 3, bullmq, failed, name, process: vi.fn(() => Promise.resolve()) });
    const job = { attemptsMade: 0, data: {}, name, opts: {} } as Job;
    const stalled = new UnrecoverableError("job stalled more than allowable limit");
    const intermediate = new Error("intermediate");
    const missing = new Error("missing job");

    try {
      await handle.ready;
      handle.queue.emit("failed", job, intermediate, "active");
      handle.queue.emit("failed", job, stalled, "active");
      handle.queue.emit("failed", undefined, missing, "active");
      expect(failed.mock.calls).toStrictEqual([
        [job, stalled],
        [undefined, missing],
      ]);
    } finally {
      await handle.close();
      await bullmq.quit();
    }
  });

  it("skips exhausted jobs whose failure is not saved", async () => {
    vi.mocked(captureException).mockClear();
    const name = `worker-${crypto.randomUUID()}`;
    const redis = connect(redisUrl);
    const queue = new Queue(name, { connection: redis });
    const lost = new Error("Missing lock for job lost. moveToFinished");
    const moveToFailed = vi.spyOn(Job.prototype, "moveToFailed").mockRejectedValueOnce(lost);
    const process = vi.fn(() => Promise.reject(new Error("exhausted")));
    const failed = vi.fn();
    const bullmq = connect(redisUrl);
    const handle = worker({ attempts: 1, bullmq, failed, name, process });

    try {
      await handle.ready;
      await queue.add("lost", {}, { attempts: 1, jobId: "lost", removeOnFail: true });
      await vi.waitFor(() => {
        expect(captureException).toHaveBeenCalledExactlyOnceWith(lost, { level: "error", tags: { queue: name } });
      });
      expect(process).toHaveBeenCalledOnce();
      expect(moveToFailed).toHaveBeenCalledOnce();
      expect(failed).not.toHaveBeenCalled();
    } finally {
      moveToFailed.mockRestore();
      await handle.close();
      await bullmq.quit();
      await queue.close();
      await redis.quit();
    }
  });

  it("isolates scope per job", async () => {
    const name = `worker-${crypto.randomUUID()}`;
    const redis = connect(redisUrl);
    const queue = new Queue(name, { connection: redis });
    const events = new QueueEvents(name, { connection: connect(redisUrl), lastEventId: await tip(redis, queue) });
    const users: unknown[] = [];
    const bullmq = connect(redisUrl);
    const handle = worker({
      attempts: 1,
      bullmq,
      failed: vi.fn(),
      name,
      process: (job) => {
        users.push(getIsolationScope().getUser());
        setUser({ id: job.id });
        users.push(getIsolationScope().getUser());
        return Promise.resolve();
      },
    });

    try {
      await Promise.all([handle.ready, events.waitUntilReady()]);
      for (const id of ["first", "second"]) {
        const result = finished(events, id);
        await queue.add("isolate", {}, { jobId: id, removeOnComplete: true });
        await result;
      }
      expect(users).toStrictEqual([{}, { id: "first" }, {}, { id: "second" }]);
      expect(getIsolationScope().getUser()).toStrictEqual({});
    } finally {
      await handle.close();
      await bullmq.quit();
      await events.close();
      await queue.close();
      await redis.quit();
    }
  });

  it("checks readiness without consuming jobs", async () => {
    argv.push("--check");
    const name = `worker-${crypto.randomUUID()}`;
    const redis = connect(redisUrl);
    const queue = new Queue(name, { connection: redis });
    const job = await queue.add("check", {});
    const process = vi.fn(() => Promise.resolve());
    const bullmq = connect(redisUrl);
    const handle = worker({
      attempts: 1,
      bullmq,
      failed: vi.fn(),
      name,
      process,
    });

    try {
      await handle.ready;
      expect(handle.check).toBe(true);
      expect(handle.queue.isRunning()).toBe(false);
      await expect(handle.close()).resolves.toBeUndefined();
      await expect(job.getState()).resolves.toBe("waiting");
      expect(process).not.toHaveBeenCalled();
    } finally {
      await handle.close();
      await bullmq.quit();
      await queue.obliterate({ force: true });
      await queue.close();
      await redis.quit();
    }
  });
});
