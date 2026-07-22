import "../mocks/sentry";

import { captureException, continueTrace, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents, type Job, type JobsOptions } from "bullmq";
import { parse } from "valibot";
import { padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";

import chain, { firewallAbi } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { bullmq } from "../../utils/redis";
import createAllow from "../../workers/allow/queue";
import allowWorker from "../../workers/allow/worker";

import type { Job as Allow } from "../../workers/allow/job";
import type createPoke from "../../workers/poke/queue";
import type * as C from "@exactly/common/generated/chain";
import type * as sentry from "@sentry/node";

const factory = inject("ExaAccountFactory");
const account = parse(Address, padHex("0xb0b", { size: 20 }));
const firewall = inject("Firewall");
const request = { account, chainId: chain.id, factory, publicKey: "0x1234" as const, source: null };
const allower = privateKeyToAccount(padHex("0xa11"));
const allow = createAllow(bullmq);
const mocks = vi.hoisted(() => ({
  closePoke: vi.fn<ReturnType<typeof createPoke>["close"]>(),
  createPoke: vi.fn<typeof createPoke>(),
  enqueuePoke: vi.fn<ReturnType<typeof createPoke>["enqueue"]>(),
  exaSend: vi.fn(),
  firewall: vi.fn<() => Address | undefined>(),
  wallet: vi.fn(),
}));

vi.mock("../../utils/wallet", () => ({ default: mocks.wallet }));
vi.mock("../../workers/poke/queue", () => ({ default: mocks.createPoke }));

vi.mock("@exactly/common/generated/chain", async (importOriginal) => {
  const original = await importOriginal<typeof C>();
  return {
    ...original,
    get firewallAddress() {
      return mocks.firewall();
    },
  };
});

const queue = new Queue<Allow, void, "allow">("allow", { connection: bullmq });
const events = new QueueEvents("allow", { connection: bullmq });
let worker: Awaited<ReturnType<typeof allowWorker>>;

async function jobFinished(
  current: Address,
  options?: JobsOptions,
  trace?: Pick<Allow, "sentryBaggage" | "sentryTrace">,
) {
  const job = await queue.add(
    "allow",
    { ...request, account: current, ...trace },
    { attempts: 1, jobId: current, removeOnComplete: true, removeOnFail: true, ...options },
  );
  await job.waitUntilFinished(events).catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
  return job;
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

afterAll(async () => {
  await Promise.all([events.close(), queue.close(), allow.close()]);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  mocks.closePoke.mockReset().mockResolvedValue();
  mocks.createPoke.mockReset().mockReturnValue({ close: mocks.closePoke, enqueue: mocks.enqueuePoke });
  mocks.enqueuePoke.mockReset().mockResolvedValue();
  mocks.exaSend.mockReset().mockResolvedValue({});
  mocks.firewall.mockReset().mockReturnValue(firewall);
  mocks.wallet.mockReset().mockReturnValue({ exaSend: mocks.exaSend });
  vi.clearAllMocks();
  await queue.drain(true);
  await queue.clean(0, 1000, "completed");
  await queue.clean(0, 1000, "failed");
});

describe("allow queue", () => {
  it("publishes firewall allow jobs", async () => {
    await expect(allow.enqueue(request)).resolves.toBeUndefined();

    const job = await queue.getJob(account);
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(account);
    expect(job.name).toBe("allow");
    expect(job.data).toStrictEqual({
      ...request,
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
    expect(startSpan).toHaveBeenCalledWith(
      { name: "allow", op: "queue.publish", attributes: { "messaging.destination.name": "allow" } },
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
    await job.remove();
  });

  it("propagates queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await expect(allow.enqueue(request)).rejects.toThrow(error);

    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("allow worker", () => {
  beforeEach(async () => {
    worker = allowWorker({ allower, bullmq });
    await worker.ready;
  });

  afterEach(async () => {
    await worker.close();
  });

  it("allows queued accounts with the isolated wallet", async () => {
    await jobFinished(account);

    expect(mocks.wallet).toHaveBeenCalledExactlyOnceWith(allower);
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "firewall.allow", op: "exa.firewall", attributes: { account } },
      { address: firewall, functionName: "allow", args: [account, true], abi: firewallAbi },
      { ignore: [`AlreadyAllowed(${account})`] },
    );
    expect(mocks.enqueuePoke).toHaveBeenCalledExactlyOnceWith({ ...request, origin: "allow" });
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ forceTransaction: true, name: "allow worker" }),
      expect.any(Function),
    );
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "allow", op: "queue.process" }),
      expect.any(Function),
    );
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("queues the poke only after allow settles", async () => {
    const deferred = Promise.withResolvers<object>();
    mocks.exaSend.mockReturnValueOnce(deferred.promise);

    const processing = jobFinished(account);
    await vi.waitUntil(() => mocks.exaSend.mock.calls.length === 1);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    deferred.resolve({});
    await processing;

    expect(mocks.enqueuePoke).toHaveBeenCalledOnce();
  });

  it("closes the poke queue after active jobs settle", async () => {
    const deferred = Promise.withResolvers<object>();
    mocks.exaSend.mockReturnValueOnce(deferred.promise);

    const processing = jobFinished(account);
    await vi.waitUntil(() => mocks.exaSend.mock.calls.length === 1);
    const closeWorker = vi.spyOn(worker.queue, "close");
    const closing = worker.close();
    expect(worker.close()).toBe(closing);
    await vi.waitUntil(() => closeWorker.mock.calls.length === 1);

    expect(mocks.closePoke).not.toHaveBeenCalled();

    deferred.resolve({});
    await processing;
    await closing;
    expect(mocks.closePoke).toHaveBeenCalledExactlyOnceWith();
  });

  it("retries allow failures", async () => {
    mocks.exaSend.mockRejectedValueOnce(new Error("rpc unavailable")).mockResolvedValueOnce({});

    await jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(mocks.enqueuePoke).toHaveBeenCalledExactlyOnceWith({ ...request, origin: "allow" });
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("captures terminal failures", async () => {
    const error = new Error("allow failed");
    const setUser = await spyScopeSetUser();
    mocks.exaSend.mockRejectedValue(error);

    await expect(
      jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 }, removeOnFail: false }),
    ).rejects.toThrow("allow failed");

    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState(account)).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(account);
    expect(job.failedReason).toBe("allow failed");
    expect(job.attemptsMade).toBe(2);
    expect(job.stacktrace).toHaveLength(2);
    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 2, id: account },
      level: "error",
      tags: { queue: "allow", job: "allow" },
    });
    await job.remove();
  });

  it("fails when the firewall is unavailable", async () => {
    const setUser = await spyScopeSetUser();
    mocks.firewall.mockReset();

    await expect(jobFinished(account)).rejects.toThrow();

    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    const captured = vi.mocked(captureException).mock.calls[0]?.[0];
    if (!(captured instanceof Error)) throw new Error("missing captured error");
    expect(captured.message).toBe("bad address");
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(captured, {
      extra: { account, attempts: 1, id: account },
      level: "error",
      tags: { queue: "allow", job: "allow" },
    });
  });

  it("retries poke publication failures", async () => {
    const error = new Error("poke unavailable");
    const setUser = await spyScopeSetUser();
    mocks.enqueuePoke.mockRejectedValue(error);

    await expect(jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } })).rejects.toThrow(
      "poke unavailable",
    );

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(mocks.enqueuePoke).toHaveBeenCalledTimes(2);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 2, id: account },
      level: "error",
      tags: { queue: "allow", job: "allow" },
    });
  });

  it("continues sentry traces", async () => {
    await jobFinished(account, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(vi.mocked(continueTrace)).toHaveBeenCalledWith(
      { sentryTrace: "trace", baggage: "baggage" },
      expect.any(Function),
    );
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.queue.emit("error", error);

    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "allow" },
    });
  });

  it("captures failed events without a job", async () => {
    const error = new Error("failed event error");
    const setUser = await spyScopeSetUser();

    worker.queue.emit("failed", undefined, error, "active");

    expect(setUser).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account: undefined, attempts: undefined, id: undefined },
      level: "error",
      tags: { queue: "allow", job: undefined },
    });
  });

  it("skips intermediate failed events with default attempts", () => {
    const error = new Error("failed event error");

    worker.queue.emit(
      "failed",
      { attemptsMade: 9, data: { account }, name: "allow", opts: {} } as Job,
      error,
      "active",
    );

    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });
});
