import "../mocks/sentry";

import { captureException, continueTrace, startSpan } from "@sentry/node";
import { Queue } from "bullmq";
import { parse } from "valibot";
import { padHex } from "viem";
import { afterAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

import chain, { firewallAbi } from "@exactly/common/generated/chain";
import stack from "@exactly/common/stack";
import { Address } from "@exactly/common/validation";

import { queue as connection } from "../../utils/redis";
import { close as closeQueue, enqueue } from "../../workers/allow/queue";
import { close, start } from "../../workers/allow/worker";
import { enqueue as enqueuePoke } from "../../workers/poke/queue";

import type { Job as Allow } from "../../workers/allow/job";
import type * as C from "@exactly/common/generated/chain";
import type { Job, JobsOptions } from "bullmq";

const factory = inject("ExaAccountFactory");
const account = parse(Address, padHex("0xb0b", { size: 20 }));
const firewall = inject("Firewall");
const request = { account, chainId: chain.id, factory, publicKey: "0x1234" as const, source: null };
const mocks = vi.hoisted(() => ({
  exaSend: vi.fn(),
  firewall: vi.fn<() => Address | undefined>(),
  getWallet: vi.fn(),
}));

vi.mock("../../utils/wallet", () => ({ getWallet: mocks.getWallet }));
vi.mock("../../workers/poke/queue", () => ({ enqueue: vi.fn<typeof enqueuePoke>() }));

vi.mock("@exactly/common/generated/chain", async (importOriginal) => {
  const original = await importOriginal<typeof C>();
  return {
    ...original,
    get firewallAddress() {
      return mocks.firewall();
    },
  };
});

const producer = new Queue<Allow, void, "allow">("allow", { connection });
let worker: Awaited<ReturnType<typeof start>>;

function allowDone(current: Address) {
  return new Promise<void>((resolve, reject) => {
    const completed = (job: Job<Allow>) => {
      if (job.data.account !== current) return;
      cleanup();
      resolve();
    };
    const failed = (job: Job<Allow> | undefined, error: Error) => {
      if (job?.data.account !== current) return;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off("completed", completed);
      worker.off("failed", failed);
    };
    worker.on("completed", completed);
    worker.on("failed", failed);
    enqueue({ ...request, account: current }).catch((error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error("queue add failed", { cause: error }));
    });
  });
}

function jobDone(
  current: Address,
  options?: JobsOptions,
  onFailed?: () => void,
  trace?: Pick<Allow, "sentryBaggage" | "sentryTrace">,
) {
  return new Promise<void>((resolve, reject) => {
    let failures = 0;
    const completed = (job: Job<Allow>) => {
      if (job.data.account !== current) return;
      cleanup();
      resolve();
    };
    const failed = (job: Job<Allow> | undefined, error: Error) => {
      if (job?.data.account !== current) return;
      failures += 1;
      onFailed?.();
      if (failures < (options?.attempts ?? 1)) return;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off("completed", completed);
      worker.off("failed", failed);
    };
    worker.on("completed", completed);
    worker.on("failed", failed);
    producer
      .add(
        "allow",
        { ...request, account: current, ...trace },
        { attempts: 1, removeOnComplete: true, removeOnFail: true, ...options },
      )
      .catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error("queue add failed", { cause: error }));
      });
  });
}

afterAll(async () => {
  await Promise.all([producer.close(), closeQueue(), close()]);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("missing redis url");
  worker = start({ redisUrl });
  vi.mocked(enqueuePoke).mockReset().mockResolvedValue();
  mocks.exaSend.mockReset().mockResolvedValue({});
  mocks.firewall.mockReset().mockReturnValue(firewall);
  mocks.getWallet.mockReset().mockResolvedValue({ exaSend: mocks.exaSend });
  vi.clearAllMocks();
  await producer.drain(true);
  await producer.clean(0, 1000, "completed");
  await producer.clean(0, 1000, "failed");
});

describe("allow queue", () => {
  it("publishes firewall allow jobs", async () => {
    const pending = Symbol("pending");
    const deferred = Promise.withResolvers<QueueJob>();
    const add = vi.spyOn(Queue.prototype, "add").mockReturnValue(deferred.promise);
    const result = enqueue(request);

    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(await Promise.race([result, Promise.resolve(pending)])).toBe(pending);
    deferred.resolve({ id: account, data: request } as unknown as QueueJob);

    await expect(result).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledExactlyOnceWith(
      "allow",
      expect.objectContaining({
        ...request,
        sentryBaggage: expect.any(String) as string,
        sentryTrace: expect.any(String) as string,
      }),
      { jobId: account },
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "account allow", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await expect(enqueue(request)).rejects.toThrow(error);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "allow", job: "allow" },
      extra: { account },
    });
  });
});

describe("allow worker", () => {
  it("allows queued accounts with the isolated wallet", async () => {
    await allowDone(account);

    expect(mocks.getWallet).toHaveBeenCalledExactlyOnceWith(`${stack}-allower`);
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "firewall.allow", op: "exa.firewall", attributes: { account } },
      { address: firewall, functionName: "allow", args: [account, true], abi: firewallAbi },
      { ignore: [`AlreadyAllowed(${account})`] },
    );
    expect(enqueuePoke).toHaveBeenCalledExactlyOnceWith({ ...request, origin: "allow" });
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

    const processing = allowDone(account);
    await vi.waitUntil(() => mocks.exaSend.mock.calls.length === 1);
    const queuedBefore = vi.mocked(enqueuePoke).mock.calls.length;
    deferred.resolve({});
    await processing;

    expect(queuedBefore).toBe(0);
    expect(enqueuePoke).toHaveBeenCalledOnce();
  });

  it("retries allow failures", async () => {
    mocks.exaSend.mockRejectedValueOnce(new Error("rpc unavailable")).mockResolvedValueOnce({});

    await jobDone(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("captures terminal failures", async () => {
    const error = new Error("allow failed");
    mocks.exaSend.mockRejectedValueOnce(error);

    await expect(jobDone(account)).rejects.toThrow("allow failed");

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, {
      extra: { account, attempts: expect.any(Number) as number, id: expect.any(String) as string },
      level: "error",
      tags: { queue: "allow", job: "allow" },
    });
  });

  it("fails when the firewall is unavailable", async () => {
    mocks.firewall.mockReset();

    await expect(jobDone(account)).rejects.toThrow();

    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(expect.any(Error), {
      extra: { account, attempts: expect.any(Number) as number, id: expect.any(String) as string },
      level: "error",
      tags: { queue: "allow", job: "allow" },
    });
  });

  it("continues sentry traces", async () => {
    await jobDone(account, undefined, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(vi.mocked(continueTrace)).toHaveBeenCalledWith(
      { sentryTrace: "trace", baggage: "baggage" },
      expect.any(Function),
    );
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.emit("error", error);

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, { level: "error", tags: { queue: "allow" } });
  });

  it("captures failed events without a job", () => {
    const error = new Error("failed event error");

    worker.emit("failed", undefined, error, "active");

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, {
      extra: { account: undefined, attempts: undefined, id: undefined },
      level: "error",
      tags: { queue: "allow", job: undefined },
    });
  });

  it("skips intermediate failed events with default attempts", () => {
    const error = new Error("failed event error");

    worker.emit("failed", { attemptsMade: 9, data: { account }, name: "allow", opts: {} } as QueueJob, error, "active");

    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });
});

type QueueJob = Awaited<ReturnType<Queue<Allow, void, "allow">["add"]>>;
