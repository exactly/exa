import "../mocks/sentry";

import { captureException, captureMessage, continueTrace, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents } from "bullmq";
import { env } from "node:process";
import { parse } from "valibot";
import { padHex, toHex } from "viem";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Address } from "@exactly/common/validation";

import { activityUrl, NETWORKS } from "../../utils/alchemy";
import redis, { bullmq } from "../../utils/redis";
import { name } from "../../workers/subscribe/job";
import createSubscribe from "../../workers/subscribe/queue";
import subscribeWorker from "../../workers/subscribe/worker";

import type * as schema from "../../database/schema";
import type createAlchemy from "../../utils/alchemy";
import type { activityNetworks, Webhook } from "../../utils/alchemy";
import type { Job as Subscribe } from "../../workers/subscribe/job";
import type * as sentry from "@sentry/node";
import type { JobsOptions } from "bullmq";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as timers from "node:timers/promises";

const mocks = vi.hoisted(() => ({ networks: new Map() as ReturnType<typeof activityNetworks> }));

vi.mock(import("../../utils/alchemy"), async (importOriginal) => ({
  ...(await importOriginal()),
  activityNetworks: () => mocks.networks,
}));
vi.mock("node:timers/promises", async (importOriginal) => {
  const original = await importOriginal<typeof timers>();
  return { ...original, setTimeout: (...arguments_: unknown[]) => original.setTimeout(0, ...arguments_.slice(1)) };
});

const account = parse(Address, padHex("0xb0b", { size: 20 }));
const queue = new Queue<Subscribe, void, typeof name>(name, { connection: bullmq });
const subscribe = createSubscribe(redis);
const events = new QueueEvents(name, { connection: bullmq });
let worker: ReturnType<typeof subscribeWorker> | undefined;

beforeAll(async () => {
  if (!env.REDIS_URL) throw new Error("missing redis url");
  await queue.drain(true);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.networks = networks("ANVIL");
  await queue.drain(true);
  await queue.clean(0, 1000, "completed");
  await queue.clean(0, 1000, "failed");
});

afterEach(async () => {
  await worker?.queue.waitUntilReady();
  await worker?.close();
  worker = undefined;
});

afterAll(async () => {
  await Promise.all([queue.close(), events.close(), subscribe.close()]);
});

describe("subscribe queue", () => {
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

  it("preserves queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await expect(subscribe.enqueue(account)).rejects.toBe(error);

    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });
});

describe("subscribe worker", () => {
  it("adopts active webhooks and adds every account in batches", async () => {
    const alchemy = api();
    const accounts = Array.from({ length: 503 }, (_, index) => address(index + 1));
    alchemy.getWebhooks.mockResolvedValue([webhook("hook")]);
    alchemy.getWebhookAddresses.mockResolvedValue({
      data: [address(1)],
      pagination: { cursors: { after: "next" }, total_count: accounts.length },
    });

    worker = subscribeWorker({ alchemy, bullmq, database: source(accounts) });
    await worker.ready;

    expect(alchemy.createWebhook).not.toHaveBeenCalled();
    expect(alchemy.getWebhookAddresses).toHaveBeenCalledExactlyOnceWith("hook");
    expect(alchemy.addWebhookAddresses).toHaveBeenCalledTimes(2);
    expect(alchemy.addWebhookAddresses).toHaveBeenNthCalledWith(1, "hook", accounts.slice(0, 500));
    expect(alchemy.addWebhookAddresses).toHaveBeenNthCalledWith(2, "hook", accounts.slice(500));
  });

  it("creates missing webhooks before backfilling", async () => {
    const alchemy = api();
    const current = address(1);
    alchemy.getWebhooks.mockResolvedValue([]);
    alchemy.createWebhook.mockResolvedValue(webhook("new"));

    worker = subscribeWorker({ alchemy, bullmq, database: source([current]) });
    await worker.ready;

    expect(alchemy.createWebhook).toHaveBeenCalledExactlyOnceWith({
      addresses: [],
      network: "ANVIL",
      webhook_type: "ADDRESS_ACTIVITY",
      webhook_url: activityUrl,
    });
    expect(alchemy.getWebhookAddresses).toHaveBeenCalledExactlyOnceWith("new");
    expect(alchemy.addWebhookAddresses).toHaveBeenCalledExactlyOnceWith("new", [current]);
    expect(alchemy.setWebhookActive).not.toHaveBeenCalled();
  });

  it("backfills before activating inactive webhooks", async () => {
    const alchemy = api();
    const current = address(1);
    alchemy.getWebhooks.mockResolvedValue([]);
    alchemy.createWebhook.mockResolvedValue(webhook("new", "ANVIL", false));
    alchemy.getWebhookAddresses.mockResolvedValue({
      data: [current],
      pagination: { cursors: {}, total_count: 1 },
    });
    alchemy.setWebhookActive.mockImplementation(() => {
      expect(alchemy.addWebhookAddresses).toHaveBeenCalledExactlyOnceWith("new", [current]);
      return Promise.resolve();
    });

    worker = subscribeWorker({ alchemy, bullmq, database: source([current]) });
    await worker.ready;

    expect(alchemy.setWebhookActive).toHaveBeenCalledExactlyOnceWith("new", true);
  });

  it("does not guess among duplicate webhooks", async () => {
    const alchemy = api();
    alchemy.getWebhooks.mockResolvedValue([webhook("first"), webhook("second")]);

    worker = subscribeWorker({ alchemy, bullmq, database: source([]) });

    await expect(worker.ready).rejects.toThrow("activity webhook discovery failed");
    await expect(worker.ready).rejects.toMatchObject({ errors: [new Error("duplicate ANVIL activity webhooks")] });
    expect(alchemy.createWebhook).not.toHaveBeenCalled();
  });

  it("continues discovery after finding an inactive webhook", async () => {
    mocks.networks = networks("ANVIL", "OPT_SEPOLIA");
    const alchemy = api();
    alchemy.getWebhooks.mockResolvedValue([webhook("inactive", "ANVIL", false)]);
    alchemy.createWebhook.mockResolvedValue(webhook("created", "OPT_SEPOLIA", false));

    worker = subscribeWorker({ alchemy, bullmq, database: source([]) });

    await expect(worker.ready).rejects.toThrow("activity webhook discovery failed");
    expect(alchemy.createWebhook).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ network: "OPT_SEPOLIA" }));
  });

  it("attempts every network when reconciliation fails", async () => {
    mocks.networks = networks("ANVIL", "OPT_SEPOLIA");
    const alchemy = api();
    const current = address(1);
    alchemy.getWebhooks.mockResolvedValue([webhook("anvil"), webhook("optimism", "OPT_SEPOLIA")]);
    alchemy.getWebhookAddresses.mockRejectedValueOnce(new Error("list failed"));
    alchemy.addWebhookAddresses.mockResolvedValueOnce().mockRejectedValueOnce(new Error("add failed"));

    worker = subscribeWorker({ alchemy, bullmq, database: source([current]) });

    await expect(worker.ready).rejects.toThrow("activity webhook reconciliation failed");
    await expect(worker.ready).rejects.toMatchObject({ errors: [new Error("list failed"), new Error("add failed")] });
    expect(alchemy.getWebhookAddresses).toHaveBeenCalledExactlyOnceWith("anvil");
    expect(alchemy.addWebhookAddresses).toHaveBeenNthCalledWith(1, "anvil", [current]);
    expect(alchemy.addWebhookAddresses).toHaveBeenNthCalledWith(2, "optimism", [current]);
  });

  it("processes jobs after discovery while reconciliation is running", async () => {
    const alchemy = api();
    const accounts = Promise.withResolvers<{ account: Address }[]>();
    alchemy.getWebhooks.mockResolvedValue([webhook("hook")]);
    worker = subscribeWorker({ alchemy, bullmq, database: source(accounts.promise) });
    const current = address(1);

    await jobFinished(current);

    expect(alchemy.addWebhookAddresses).toHaveBeenCalledExactlyOnceWith("hook", [current]);
    accounts.resolve([]);
    await worker.ready;
  });

  it("attempts every webhook for incremental subscriptions", async () => {
    mocks.networks = networks("ANVIL", "OPT_SEPOLIA");
    const alchemy = api();
    alchemy.getWebhooks.mockResolvedValue([webhook("anvil"), webhook("optimism", "OPT_SEPOLIA")]);
    worker = subscribeWorker({ alchemy, bullmq, database: source([]) });
    await worker.ready;
    alchemy.addWebhookAddresses.mockRejectedValueOnce(new Error("first failed")).mockResolvedValueOnce();
    const current = address(1);

    await expect(jobFinished(current)).rejects.toThrow("account subscription failed");

    expect(alchemy.addWebhookAddresses).toHaveBeenNthCalledWith(1, "anvil", [current]);
    expect(alchemy.addWebhookAddresses).toHaveBeenNthCalledWith(2, "optimism", [current]);
  });

  it("warns and fails before reaching provider capacity", async () => {
    const alchemy = api();
    alchemy.getWebhooks.mockResolvedValue([webhook("full")]);
    alchemy.getWebhookAddresses.mockResolvedValue({
      data: [],
      pagination: { cursors: {}, total_count: 100_000 },
    });

    worker = subscribeWorker({ alchemy, bullmq, database: source([]) });

    await expect(worker.ready).rejects.toThrow("activity webhook reconciliation failed");
    expect(captureMessage).toHaveBeenCalledExactlyOnceWith("alchemy activity webhook nearing capacity", {
      level: "warning",
      tags: { network: "ANVIL", webhook: "full" },
      extra: { addresses: 100_000 },
    });
    expect(alchemy.addWebhookAddresses).not.toHaveBeenCalled();
  });

  it("adds accounts that are already subscribed", async () => {
    const alchemy = api();
    const current = address(1);
    alchemy.getWebhooks.mockResolvedValue([webhook("hook")]);
    alchemy.getWebhookAddresses.mockResolvedValue({
      data: [current],
      pagination: { cursors: {}, total_count: 1 },
    });

    worker = subscribeWorker({ alchemy, bullmq, database: source([current]) });
    await worker.ready;

    expect(alchemy.addWebhookAddresses).toHaveBeenCalledExactlyOnceWith("hook", [current]);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("subscribes an account to every active webhook", async () => {
    mocks.networks = networks("ANVIL", "OPT_SEPOLIA");
    const alchemy = api();
    alchemy.getWebhooks.mockResolvedValue([webhook("anvil"), webhook("optimism", "OPT_SEPOLIA")]);
    worker = subscribeWorker({ alchemy, bullmq, database: source([]) });
    await worker.ready;

    await jobFinished(account);

    expect(alchemy.addWebhookAddresses).toHaveBeenNthCalledWith(1, "anvil", [account]);
    expect(alchemy.addWebhookAddresses).toHaveBeenNthCalledWith(2, "optimism", [account]);
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ forceTransaction: true, name: "subscribe worker" }),
      expect.any(Function),
    );
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "subscribe", op: "queue.process" }),
      expect.any(Function),
    );
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("activates an empty inactive webhook after its first subscription", async () => {
    const alchemy = api();
    alchemy.getWebhooks.mockResolvedValue([]);
    alchemy.createWebhook.mockResolvedValue(webhook("new", "ANVIL", false));
    alchemy.setWebhookActive.mockImplementation(() => {
      expect(alchemy.addWebhookAddresses).toHaveBeenCalledExactlyOnceWith("new", [account]);
      return Promise.resolve();
    });
    worker = subscribeWorker({ alchemy, bullmq, database: source([]) });
    await worker.ready;

    expect(alchemy.setWebhookActive).not.toHaveBeenCalled();

    await jobFinished(account);

    expect(alchemy.setWebhookActive).toHaveBeenCalledExactlyOnceWith("new", true);
  });

  it("retries alchemy failures", async () => {
    const alchemy = api();
    worker = subscribeWorker({ alchemy, bullmq, database: source([]) });
    await worker.ready;
    alchemy.addWebhookAddresses.mockRejectedValueOnce(new Error("bad")).mockResolvedValueOnce();

    await jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(alchemy.addWebhookAddresses).toHaveBeenCalledTimes(2);
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("normalizes non-error failures", async () => {
    const alchemy = api();
    worker = subscribeWorker({ alchemy, bullmq, database: source([]) });
    await worker.ready;
    alchemy.addWebhookAddresses.mockRejectedValueOnce("bad");
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account)).rejects.toThrow("account subscription failed");

    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "account subscription failed", errors: ["bad"] }),
      {
        level: "error",
        tags: { queue: "subscribe", job: "subscribe" },
        extra: { account, attempts: 1, id: account },
      },
    );
  });

  it("continues sentry traces", async () => {
    const alchemy = api();
    worker = subscribeWorker({ alchemy, bullmq, database: source([]) });
    await worker.ready;

    await jobFinished(account, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(vi.mocked(continueTrace)).toHaveBeenCalledWith(
      { sentryTrace: "trace", baggage: "baggage" },
      expect.any(Function),
    );
  });

  it("captures worker errors", async () => {
    const error = new Error("worker error");
    worker = subscribeWorker({ alchemy: api(), bullmq, database: source([]) });
    await worker.ready;

    worker.queue.emit("error", error);

    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "subscribe" },
    });
  });

  it("captures failed events without a job", async () => {
    const error = new Error("failed event error");
    worker = subscribeWorker({ alchemy: api(), bullmq, database: source([]) });
    await worker.ready;
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
    const alchemy = api();
    worker = subscribeWorker({ alchemy, bullmq, database: source([]) });
    await worker.ready;
    alchemy.addWebhookAddresses.mockRejectedValueOnce(error);
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account, { removeOnFail: false })).rejects.toThrow("account subscription failed");

    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState(account)).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(account);
    expect(job.failedReason).toBe("account subscription failed");
    expect(job.attemptsMade).toBe(1);
    expect(job.stacktrace).toHaveLength(1);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "account subscription failed", errors: [error] }),
      {
        level: "error",
        tags: { queue: "subscribe", job: "subscribe" },
        extra: { account, attempts: 1, id: account },
      },
    );
    await job.remove();
  });

  it("captures only terminal failed events", async () => {
    const error = new Error("alchemy failed");
    const alchemy = api();
    worker = subscribeWorker({ alchemy, bullmq, database: source([]) });
    await worker.ready;
    alchemy.addWebhookAddresses.mockRejectedValue(error);
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } })).rejects.toThrow(
      "account subscription failed",
    );

    expect(alchemy.addWebhookAddresses).toHaveBeenCalledTimes(2);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "account subscription failed", errors: [error] }),
      {
        level: "error",
        tags: { queue: "subscribe", job: "subscribe" },
        extra: { account, attempts: 2, id: account },
      },
    );
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

function api() {
  return {
    addWebhookAddresses: vi.fn<ReturnType<typeof createAlchemy>["addWebhookAddresses"]>().mockResolvedValue(),
    createWebhook: vi.fn<ReturnType<typeof createAlchemy>["createWebhook"]>(),
    findWebhook: vi.fn<ReturnType<typeof createAlchemy>["findWebhook"]>().mockResolvedValue(undefined), // eslint-disable-line unicorn/no-useless-undefined -- unused client method
    getWebhookAddresses: vi.fn<ReturnType<typeof createAlchemy>["getWebhookAddresses"]>().mockResolvedValue({
      data: [],
      pagination: { cursors: {}, total_count: 0 },
    }),
    getWebhooks: vi.fn<ReturnType<typeof createAlchemy>["getWebhooks"]>().mockResolvedValue([webhook("hook")]),
    headers: { "Content-Type": "application/json", "X-Alchemy-Token": "test" },
    setWebhookActive: vi.fn<ReturnType<typeof createAlchemy>["setWebhookActive"]>().mockResolvedValue(),
  } satisfies ReturnType<typeof createAlchemy>;
}

function webhook(id: string, network = "ANVIL", active = true): Webhook {
  return {
    id,
    is_active: active,
    network,
    signing_key: `${id}-key`,
    webhook_type: "ADDRESS_ACTIVITY",
    webhook_url: activityUrl,
  };
}

function address(index: number) {
  return parse(Address, padHex(toHex(index), { size: 20 }));
}

function networks(...capabilities: string[]) {
  return new Map(
    capabilities.map((capability) => {
      const chain = NETWORKS.get(capability);
      if (!chain) throw new Error(`missing ${capability} network`);
      return [capability, chain] as const;
    }),
  );
}

function source(accounts: Address[] | Promise<{ account: Address }[]>) {
  return {
    query: {
      credentials: {
        findMany: () =>
          accounts instanceof Promise ? accounts : Promise.resolve(accounts.map((current) => ({ account: current }))),
      },
    },
  } as unknown as NodePgDatabase<typeof schema>;
}
