import "../mocks/sentry";

import { captureException, continueTrace, startSpan } from "@sentry/node";
import { Queue } from "bullmq";
import { env } from "node:process";
import { parse } from "valibot";
import { padHex } from "viem";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Address } from "@exactly/common/validation";

import createAlchemy from "../../utils/alchemy";
import { bullmq, close as closeRedis } from "../../utils/redis";
import { name } from "../../workers/subscribe/job";
import createSubscribe from "../../workers/subscribe/queue";
import subscribeWorker from "../../workers/subscribe/worker";

import type { Job as Subscribe } from "../../workers/subscribe/job";
import type { Job, JobsOptions } from "bullmq";

const mocks = vi.hoisted(() => ({ webhookId: "webhook-id" as string | undefined }));

vi.mock("../../utils/activityWebhook", () => ({
  get webhookId() {
    return mocks.webhookId;
  },
}));

const account = parse(Address, padHex("0xb0b", { size: 20 }));
const queue = new Queue<Subscribe, void, typeof name>(name, { connection: bullmq });
const subscribe = createSubscribe(bullmq, createAlchemy("webhooks"));
let worker: ReturnType<typeof subscribeWorker>;

function jobDone(
  current: Address,
  options?: JobsOptions,
  onFailed?: () => void,
  trace?: Pick<Subscribe, "sentryBaggage" | "sentryTrace">,
) {
  return new Promise<void>((resolve, reject) => {
    let failures = 0;
    const completed = (job: Job<Subscribe>) => {
      if (job.data.account !== current) return;
      cleanup();
      resolve();
    };
    const failed = (job: Job<Subscribe> | undefined, error: Error) => {
      if (job?.data.account !== current) return;
      failures += 1;
      onFailed?.();
      if (failures < (options?.attempts ?? 1)) return;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.queue.off("completed", completed);
      worker.queue.off("failed", failed);
    };
    worker.queue.on("completed", completed);
    worker.queue.on("failed", failed);
    queue
      .add(
        name,
        { account: current, ...trace },
        { attempts: 1, removeOnComplete: true, removeOnFail: true, ...options },
      )
      .catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error("queue add failed", { cause: error }));
      });
  });
}

function bodies() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => {
    if (!init || typeof init.body !== "string") throw new Error("missing body");
    return JSON.parse(init.body) as unknown;
  });
}

afterAll(async () => {
  await queue.close();
  await subscribe.close();
  await closeRedis();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("subscribe queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.webhookId = "hook-a";
  });

  it("publishes account subscriptions", async () => {
    const pending = Symbol("pending");
    const deferred = Promise.withResolvers<Job<Subscribe, void, typeof name>>();
    const add = vi.spyOn(Queue.prototype, "add").mockReturnValue(deferred.promise);
    const result = subscribe.enqueue(account);

    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(await Promise.race([result, Promise.resolve(pending)])).toBe(pending);
    deferred.resolve({ id: "subscribe", data: { account } } as Job<Subscribe, void, typeof name>);

    await expect(result).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledExactlyOnceWith(
      "subscribe",
      expect.objectContaining({
        account,
        sentryBaggage: expect.any(String) as string,
        sentryTrace: expect.any(String) as string,
      }),
      { jobId: account },
    );
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "subscribe", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
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

    await expect(subscribe.enqueue(account)).resolves.toBeUndefined();

    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(expect.any(AggregateError), {
      level: "error",
      tags: { queue: "subscribe", job: "subscribe", fallback: "failed" },
      extra: { account },
    });
    const captured = vi.mocked(captureException).mock.calls[0]?.[0];
    if (!(captured instanceof AggregateError)) throw new Error("missing aggregate error");
    expect(captured.errors).toStrictEqual([error, fallback]);
  });
});

describe("subscribe worker", () => {
  beforeAll(async () => {
    const redisUrl = env.REDIS_URL;
    if (!redisUrl) throw new Error("missing redis url");
    worker = subscribeWorker({ alchemyKey: "worker", redisUrl });
    await worker.ready;
  });

  afterAll(async () => {
    await worker.close();
  });

  beforeEach(async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    vi.clearAllMocks();
    mocks.webhookId = "hook-a";
    await queue.drain(true);
    await queue.clean(0, 1000, "completed");
    await queue.clean(0, 1000, "failed");
  });

  it("subscribes an account to active webhooks", async () => {
    await jobDone(account);

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

    await jobDone(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bodies()).toStrictEqual([
      { webhook_id: "hook-a", addresses_to_add: [account], addresses_to_remove: [] },
      { webhook_id: "hook-a", addresses_to_add: [account], addresses_to_remove: [] },
    ]);
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("marks non-error failures without their message", async () => {
    vi.mocked(fetch).mockRejectedValueOnce("bad");

    await expect(jobDone(account)).rejects.toBe("bad");

    expect(vi.mocked(captureException)).toHaveBeenCalledWith("bad", {
      level: "error",
      tags: { queue: "subscribe", job: "subscribe" },
      extra: { account, attempts: expect.any(Number) as number, id: expect.any(String) as string },
    });
  });

  it("continues sentry traces", async () => {
    await jobDone(account, undefined, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(vi.mocked(continueTrace)).toHaveBeenCalledWith(
      { sentryTrace: "trace", baggage: "baggage" },
      expect.any(Function),
    );
  });

  it("fails when no active webhook exists", async () => {
    mocks.webhookId = undefined;

    await expect(jobDone(account)).rejects.toThrow("no active webhook");

    expect(fetch).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(expect.any(Error), {
      level: "error",
      tags: { queue: "subscribe", job: "subscribe" },
      extra: {
        account,
        attempts: expect.any(Number) as number,
        id: expect.any(String) as string,
      },
    });
  });

  it("resolves active webhook again on retry", async () => {
    const retry = parse(Address, padHex("0xbee", { size: 20 }));
    mocks.webhookId = undefined;

    await jobDone(retry, { attempts: 2, backoff: { type: "fixed", delay: 1 } }, () => {
      mocks.webhookId = "hook-a";
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodies()).toStrictEqual([{ webhook_id: "hook-a", addresses_to_add: [retry], addresses_to_remove: [] }]);
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.queue.emit("error", error);

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, { level: "error", tags: { queue: "subscribe" } });
  });

  it("captures failed events without a job", () => {
    const error = new Error("failed event error");

    worker.queue.emit("failed", undefined, error, "active");

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, {
      level: "error",
      tags: { queue: "subscribe", job: undefined },
      extra: { account: undefined, attempts: undefined, id: undefined },
    });
  });

  it("skips intermediate failed events with default attempts", () => {
    const error = new Error("failed event error");

    worker.queue.emit(
      "failed",
      { attemptsMade: 9, data: { account }, name: "subscribe", opts: {} } as Job<Subscribe, void, typeof name>,
      error,
      "active",
    );

    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });
});
