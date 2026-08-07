import "../mocks/sentry";

import { captureException, continueTrace, startSpan } from "@sentry/node";
import { Queue } from "bullmq";
import { env } from "node:process";
import { parse } from "valibot";
import { padHex, toHex } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { refunderAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { bullmq } from "../../utils/redis";
import createRefund from "../../workers/refund/queue";
import refundWorker from "../../workers/refund/worker";

import type { Job as Refund } from "../../workers/refund/job";
import type * as C from "@exactly/common/generated/chain";
import type { Job, JobsOptions } from "bullmq";

const account = parse(Address, padHex("0xb0b", { size: 20 }));
const signer = { address: account };
const refund = createRefund(bullmq);
const queue = new Queue<Refund, void, "refund">("refund", { connection: bullmq });
let worker: Awaited<ReturnType<typeof refundWorker>>;

function jobDone(
  amount: bigint,
  options?: JobsOptions,
  onFailed?: () => void,
  trace?: Pick<Refund, "sentryBaggage" | "sentryTrace">,
) {
  return new Promise<void>((resolve, reject) => {
    let failures = 0;
    const completed = (job: Job<Refund>) => {
      if (job.data.amount !== String(amount)) return;
      cleanup();
      resolve();
    };
    const failed = (job: Job<Refund> | undefined, error: Error) => {
      if (job?.data.amount !== String(amount)) return;
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
        "refund",
        { amount: String(amount) as `${bigint}`, ...trace },
        { attempts: 1, removeOnComplete: true, removeOnFail: true, ...options },
      )
      .catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error("queue add failed", { cause: error }));
      });
  });
}

afterAll(async () => {
  await Promise.all([queue.close(), refund.close()]);
});

describe("refund queue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("publishes refund jobs", async () => {
    const instance = createRefund(bullmq);
    const pending = Symbol("pending");
    const deferred = Promise.withResolvers<Job<Refund, void, "refund">>();
    const add = vi.spyOn(Queue.prototype, "add").mockReturnValue(deferred.promise);
    const result = instance.enqueue(1_000_000n, "refund");

    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(await Promise.race([result, Promise.resolve(pending)])).toBe(pending);
    deferred.resolve({ id: "refund", data: { amount: "1000000" } } as unknown as Job<Refund, void, "refund">);

    await expect(result).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledExactlyOnceWith(
      "refund",
      expect.objectContaining({
        amount: "1000000",
        sentryBaggage: expect.any(String) as string,
        sentryTrace: expect.any(String) as string,
      }),
      { jobId: "refund" },
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "refund", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
    await instance.close();
  });

  it("captures queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await expect(refund.enqueue(2_000_000n, "refund")).resolves.toBeUndefined();

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "refund", job: "refund" },
      extra: { amount: "2000000", id: "refund" },
    });
  });
});

describe("refund startup", () => {
  it("fails when the signer is unavailable", async () => {
    const error = Object.assign(new Error("kms key version not found"), { code: 5 });
    mocks.getAccount.mockRejectedValueOnce(error);

    await expect(
      refundWorker({ pandaKey: "panda", pandaUrl: "https://panda.test", redisUrl: "redis://unused" }),
    ).rejects.toBe(error);

    expect(mocks.getAccount).toHaveBeenCalledExactlyOnceWith("refunder");
    expect(mocks.getWallet).not.toHaveBeenCalled();
  });
});

describe("refund worker", () => {
  beforeAll(async () => {
    const redisUrl = env.REDIS_URL;
    if (!redisUrl) throw new Error("missing redis url");
    mocks.getAccount.mockResolvedValue(signer);
    worker = await refundWorker({ pandaKey: "panda", pandaUrl: "https://panda.test", redisUrl });
    await worker.ready;
  });

  afterAll(async () => {
    await worker.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    mocks.exaSend.mockReset().mockResolvedValue({});
    mocks.getAccount.mockReset().mockResolvedValue(signer);
    mocks.getWallet.mockReset().mockReturnValue({ account: { address: account }, exaSend: mocks.exaSend });
    vi.spyOn(globalThis, "fetch").mockImplementation((url) =>
      Promise.resolve(
        Response.json({
          parameters: [
            account,
            account,
            String(BigInt(new URL(url instanceof Request ? url.url : url).searchParams.get("amount") ?? 0) * 10_000n),
            refunderAddress,
            1_700_000_000,
            [1, 2, 3],
            "0x1234",
          ],
        }),
      ),
    );
    vi.clearAllMocks();
    await queue.drain(true);
    await queue.clean(0, 1000, "completed");
    await queue.clean(0, 1000, "failed");
  });

  it("withdraws from panda for the refund wallet", async () => {
    await jobDone(1_000_000n);

    expect(mocks.getWallet).toHaveBeenCalledExactlyOnceWith(signer);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        `/issuing/tenants/signatures/withdrawals?token=0x29684075a3C86ea11D9964BcAf0F956e801396bD&amount=100&recipientAddress=${refunderAddress}&adminAddress=${account}`,
      ),
      expect.objectContaining({ headers: expect.objectContaining({ "Api-Key": "panda" }) as unknown, method: "GET" }),
    );
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "panda.withdraw",
        op: "panda.withdraw",
        attributes: { account: refunderAddress },
      }),
      expect.objectContaining({
        args: [account, account, 1_000_000n, refunderAddress, 1_700_000_000n, toHex(Buffer.from([1, 2, 3])), "0x1234"],
        functionName: "withdrawAsset",
      }),
    );
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ forceTransaction: true, name: "refund worker" }),
      expect.any(Function),
    );
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "refund", op: "queue.process" }),
      expect.any(Function),
    );
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("retries panda withdrawal failures", async () => {
    mocks.exaSend.mockRejectedValueOnce(new Error("panda down")).mockResolvedValueOnce({});

    await jobDone(2_000_000n, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("captures terminal failures", async () => {
    const error = new Error("withdraw failed");
    mocks.exaSend.mockRejectedValueOnce(error);

    await expect(jobDone(3_000_000n)).rejects.toThrow("withdraw failed");

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, {
      level: "error",
      tags: { queue: "refund", job: "refund" },
      extra: {
        amount: "3000000",
        attempts: expect.any(Number) as number,
        id: expect.any(String) as string,
        recipient: refunderAddress,
      },
    });
  });

  it("captures panda withdrawal rejections", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("panda error", { status: 502 }));

    await expect(jobDone(5_000_000n)).rejects.toThrow("panda error");

    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Panda502", message: "panda error", status: 502, cause: "panda error" }),
      {
        level: "error",
        tags: { queue: "refund", job: "refund" },
        extra: {
          amount: "5000000",
          attempts: expect.any(Number) as number,
          id: expect.any(String) as string,
          recipient: refunderAddress,
        },
      },
    );
  });

  it("continues sentry traces", async () => {
    await jobDone(4_000_000n, undefined, undefined, {
      sentryBaggage: "baggage",
      sentryTrace: "trace",
    });

    expect(vi.mocked(continueTrace)).toHaveBeenCalledWith(
      { sentryTrace: "trace", baggage: "baggage" },
      expect.any(Function),
    );
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.queue.emit("error", error);

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, { level: "error", tags: { queue: "refund" } });
  });

  it("captures failed events without a job", () => {
    const error = new Error("failed event error");

    worker.queue.emit("failed", undefined, error, "active");

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, {
      level: "error",
      tags: { queue: "refund", job: undefined },
      extra: { amount: undefined, attempts: undefined, id: undefined, recipient: refunderAddress },
    });
  });

  it("skips intermediate failed events with default attempts", () => {
    const error = new Error("failed event error");

    worker.queue.emit(
      "failed",
      {
        attemptsMade: 9,
        data: { amount: "1" },
        name: "refund",
        opts: {},
      } as unknown as Job<Refund, void, "refund">,
      error,
      "active",
    );

    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });
});

const mocks = vi.hoisted(() => ({
  exaSend: vi.fn(),
  getAccount: vi.fn(),
  getWallet: vi.fn(),
}));

vi.mock("../../utils/wallet", () => ({
  getAccount: mocks.getAccount,
  getWallet: mocks.getWallet,
}));

vi.mock("@exactly/common/generated/chain", async (importOriginal) => {
  const original = await importOriginal<typeof C>();
  const { baseSepolia } = await import("viem/chains");
  return {
    ...original,
    default: Object.assign({ id: 0 }, baseSepolia, {
      rpcUrls: { ...baseSepolia.rpcUrls, alchemy: baseSepolia.rpcUrls.default },
    }),
  };
});
