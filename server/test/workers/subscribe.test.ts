import "../mocks/sentry";

import { captureException, continueTrace, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents } from "bullmq";
import { env } from "node:process";
import { parse } from "valibot";
import { padHex } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Address } from "@exactly/common/validation";

import createAlchemy from "../../utils/alchemy";
import redis, { bullmq } from "../../utils/redis";
import { name } from "../../workers/subscribe/job";
import createSubscribe from "../../workers/subscribe/queue";
import subscribeWorker from "../../workers/subscribe/worker";

import type { Job as Subscribe } from "../../workers/subscribe/job";
import type * as sentry from "@sentry/node";
import type { JobsOptions } from "bullmq";

const mocks = vi.hoisted(() => ({ webhookId: "webhook-id" as string | undefined }));

vi.mock("../../utils/activityWebhook", () => ({
  get webhookId() {
    return mocks.webhookId;
  },
}));

const account = parse(Address, padHex("0xb0b", { size: 20 }));
const queue = new Queue<Subscribe, void, typeof name>(name, { connection: bullmq });
const subscribe = createSubscribe(redis, createAlchemy("webhooks"));
const events = new QueueEvents(name, { connection: bullmq });
let worker: ReturnType<typeof subscribeWorker>;

function bodies() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => {
    if (!init || typeof init.body !== "string") throw new Error("missing body");
    return JSON.parse(init.body) as unknown;
  });
}

afterAll(async () => {
  await Promise.all([queue.close(), events.close(), subscribe.close()]);
});

describe("subscribe queue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.webhookId = "hook-a";
  });

  it("publishes account subscriptions", async () => {
    await expect(subscribe.enqueue(account)).resolves.toBeUndefined();

    const job = await queue.getJob(account);
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(account);
    expect(job.name).toBe("subscribe");
    expect(job.data).toStrictEqual({
      account,
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(job.opts).toStrictEqual({
      attempts: 10,
      backoff: { type: "exponential", delay: 1000 },
      jobId: account,
      removeOnComplete: true,
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    });
    await expect(job.getState()).resolves.toBe("waiting");
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "subscribe", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
    await job.remove();
  });

  it("recovers queue failures before resolving", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);
    const pending = Symbol("pending");
    const fallback = Promise.withResolvers<Response>();
    vi.spyOn(globalThis, "fetch").mockReturnValue(fallback.promise);
    const result = subscribe.enqueue(account);

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(await Promise.race([result, Promise.resolve(pending)])).toBe(pending);
    fallback.resolve(new Response("{}"));

    await expect(result).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://dashboard.alchemy.com/api/update-webhook-addresses", {
      body: JSON.stringify({ webhook_id: "hook-a", addresses_to_add: [account], addresses_to_remove: [] }),
      headers: { "Content-Type": "application/json", "X-Alchemy-Token": "webhooks" },
      method: "PATCH",
    });
    expect(bodies()).toStrictEqual([{ webhook_id: "hook-a", addresses_to_add: [account], addresses_to_remove: [] }]);
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      { name: "subscribe fallback", op: "queue.recover", attributes: { account } },
      expect.any(Function),
    );
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      level: "warning",
      tags: { queue: "subscribe", job: "subscribe", fallback: "succeeded" },
      extra: { account },
    });
  });

  it("captures queue and recovery failures", async () => {
    const error = new Error("queue error");
    const fallback = new Error("alchemy error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(fallback);

    await expect(subscribe.enqueue(account)).rejects.toThrow("account subscription failed");

    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(expect.any(AggregateError), {
      level: "error",
      tags: { queue: "subscribe", job: "subscribe", fallback: "failed" },
      extra: { account },
    });
    const captured = vi.mocked(captureException).mock.calls[0]?.[0];
    if (!(captured instanceof AggregateError)) throw new Error("missing aggregate error");
    expect(captured.message).toBe("account subscription failed");
    expect(captured.errors).toStrictEqual([error, fallback]);
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      { name: "subscribe fallback", op: "queue.recover", attributes: { account } },
      expect.any(Function),
    );
  });
});

describe("subscribe worker", () => {
  beforeAll(async () => {
    const redisUrl = env.REDIS_URL;
    if (!redisUrl) throw new Error("missing redis url");
    await queue.drain(true);
    worker = subscribeWorker({ alchemy: createAlchemy("worker"), bullmq });
    await worker.ready;
  });

  afterAll(async () => {
    await worker.close();
    await worker.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    vi.clearAllMocks();
    mocks.webhookId = "hook-a";
    await queue.drain(true);
    await queue.clean(0, 1000, "completed");
    await queue.clean(0, 1000, "failed");
  });

  it("subscribes an account to active webhooks", async () => {
    await jobFinished(account);

    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://dashboard.alchemy.com/api/update-webhook-addresses", {
      body: JSON.stringify({ webhook_id: "hook-a", addresses_to_add: [account], addresses_to_remove: [] }),
      headers: { "Content-Type": "application/json", "X-Alchemy-Token": "worker" },
      method: "PATCH",
    });
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({
        forceTransaction: true,
        name: "subscribe worker",
      }),
      expect.any(Function),
    );
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "subscribe",
        op: "queue.process",
      }),
      expect.any(Function),
    );
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("retries alchemy failures", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("bad", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}"));

    await jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bodies()).toStrictEqual([
      { webhook_id: "hook-a", addresses_to_add: [account], addresses_to_remove: [] },
      { webhook_id: "hook-a", addresses_to_add: [account], addresses_to_remove: [] },
    ]);
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("normalizes non-error failures", async () => {
    vi.mocked(fetch).mockRejectedValueOnce("bad");
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account)).rejects.toThrow("bad");

    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "bad" }), {
      level: "error",
      tags: { queue: "subscribe", job: "subscribe" },
      extra: { account, attempts: 1, id: account },
    });
  });

  it("continues sentry traces", async () => {
    await jobFinished(account, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(vi.mocked(continueTrace)).toHaveBeenCalledWith(
      { sentryTrace: "trace", baggage: "baggage" },
      expect.any(Function),
    );
  });

  it("fails when no active webhook exists", async () => {
    mocks.webhookId = undefined;
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account)).rejects.toThrow("no active webhook");

    expect(fetch).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "no active webhook" }),
      {
        level: "error",
        tags: { queue: "subscribe", job: "subscribe" },
        extra: { account, attempts: 1, id: account },
      },
    );
  });

  it("resolves active webhook again on retry", async () => {
    const retry = parse(Address, padHex("0xbee", { size: 20 }));
    mocks.webhookId = undefined;
    worker.queue.once("failed", () => {
      mocks.webhookId = "hook-a";
    });

    await jobFinished(retry, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodies()).toStrictEqual([{ webhook_id: "hook-a", addresses_to_add: [retry], addresses_to_remove: [] }]);
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.queue.emit("error", error);

    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "subscribe" },
    });
  });

  it("captures failed events without a job", async () => {
    const error = new Error("failed event error");
    const setUser = await spyScopeSetUser();

    worker.queue.emit("failed", undefined, error, "active");

    expect(setUser).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "subscribe", job: undefined },
      extra: { account: undefined, attempts: undefined, id: undefined },
    });
  });

  it("captures persisted terminal failures", async () => {
    const error = new Error("alchemy failed");
    vi.mocked(fetch).mockRejectedValueOnce(error);
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account, { removeOnFail: false })).rejects.toThrow("alchemy failed");

    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState(account)).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(account);
    expect(job.failedReason).toBe("alchemy failed");
    expect(job.attemptsMade).toBe(1);
    expect(job.stacktrace).toHaveLength(1);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "subscribe", job: "subscribe" },
      extra: { account, attempts: 1, id: account },
    });
    await job.remove();
  });

  it("captures only terminal failed events", async () => {
    const error = new Error("alchemy failed");
    vi.mocked(fetch).mockRejectedValue(error);
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } })).rejects.toThrow(
      "alchemy failed",
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "subscribe", job: "subscribe" },
      extra: { account, attempts: 2, id: account },
    });
  });
});

async function jobFinished(
  current: Address,
  options?: JobsOptions,
  trace?: Pick<Subscribe, "sentryBaggage" | "sentryTrace">,
) {
  const job = await queue.add(
    name,
    { account: current, ...trace },
    { attempts: 1, jobId: current, removeOnComplete: true, removeOnFail: true, ...options },
  );
  await job.waitUntilFinished(events).catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
}

async function spyScopeSetUser() {
  const { withScope: realWithScope } = await vi.importActual<typeof sentry>("@sentry/node");
  const setUser = vi.fn();
  vi.mocked(withScope).mockImplementation((_scopeOrCallback, _callback?) =>
    realWithScope((scope) => {
      const originalSetUser = scope.setUser.bind(scope);
      scope.setUser = (...args: Parameters<typeof scope.setUser>) => {
        setUser(...args);
        return originalSetUser(...args);
      };
      return ((_callback ?? _scopeOrCallback) as NonNullable<typeof _callback>)(scope);
    }),
  );
  return setUser;
}
