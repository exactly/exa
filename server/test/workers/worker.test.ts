/// <reference types="vite/client" />
import "../mocks/sentry";

import { Queue } from "bullmq";
import { argv, env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";

import worker, { connect } from "../../workers/worker";

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
      close: () => bullmq.quit(),
      failed: vi.fn(),
      name: "worker-production",
      process,
    });

    await handle.ready;

    expect(handle.check).toBe(false);
    expect(handle.queue.isRunning()).toBe(true);
    expect(process).not.toHaveBeenCalled();
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it("composes custom readiness", async () => {
    const ready = Promise.withResolvers<boolean>();
    const bullmq = connect(redisUrl);
    const handle = worker({
      attempts: 1,
      bullmq,
      close: () => bullmq.quit(),
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
      close: () => bullmq.quit(),
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
      await queue.obliterate({ force: true });
      await queue.close();
      await redis.quit();
    }
  });
});
