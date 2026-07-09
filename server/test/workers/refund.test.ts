import "../mocks/sentry";

import { captureException, continueTrace, startSpan } from "@sentry/node";
import { Queue, QueueEvents } from "bullmq";
import { parse } from "valibot";
import { padHex, toHex } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { refunderAddress } from "@exactly/common/generated/chain";
import stack from "@exactly/common/stack";
import { Address } from "@exactly/common/validation";

import { bullmq } from "../../utils/redis";
import { close as closeRefund, enqueue as enqueueRefund } from "../../workers/refund/queue";
import refundWorker from "../../workers/refund/worker";

import type { Job as Refund } from "../../workers/refund/job";
import type * as C from "@exactly/common/generated/chain";
import type { JobsOptions } from "bullmq";

const account = parse(Address, padHex("0xb0b", { size: 20 }));
const queue = new Queue<Refund, void, "refund">("refund", { connection: bullmq });
const events = new QueueEvents("refund", { connection: bullmq });
const webhooks = new Map<string, unknown>();
let worker: ReturnType<typeof refundWorker>;

afterAll(async () => {
  await Promise.all([queue.close(), events.close(), closeRefund()]);
});

describe("refund queue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("publishes refund jobs", async () => {
    await expect(enqueueRefund("wh-queue")).resolves.toBeUndefined();

    const job = await queue.getJob("wh-queue");
    if (!job) throw new Error("job not found");
    expect(job.id).toBe("wh-queue");
    expect(job.name).toBe("refund");
    expect(job.data).toStrictEqual({
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(job.opts).toStrictEqual({
      attempts: 10,
      backoff: { type: "exponential", delay: 1000 },
      jobId: "wh-queue",
      removeOnComplete: true,
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    });
    await expect(job.getState()).resolves.toBe("waiting");
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "refund", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
    await job.remove();
  });

  it("captures queue failures", async () => {
    const error = new Error("redis down");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await expect(enqueueRefund("wh-queue-failure")).resolves.toBeUndefined();

    await expect(queue.getJob("wh-queue-failure")).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "refund", job: "refund" },
      extra: { id: "wh-queue-failure" },
    });
  });
});

describe("refund worker", () => {
  beforeAll(async () => {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("missing redis url");
    await queue.drain(true);
    worker = refundWorker({ pandaKey: "panda", pandaUrl: "https://panda.test", redisUrl });
    await worker.ready;
  });

  afterAll(async () => {
    await worker.close();
    await worker.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    mocks.exaSend.mockReset().mockResolvedValue({});
    mocks.getWallet.mockReset().mockResolvedValue({ account: { address: account }, exaSend: mocks.exaSend });
    webhooks.clear();
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.startsWith("/issuing/webhooks/")) {
        return Promise.resolve(Response.json(webhooks.get(url.pathname.split("/").at(-1) ?? "")));
      }
      return Promise.resolve(
        Response.json({
          parameters: [
            account,
            account,
            url.searchParams.get("amount") ?? "0",
            refunderAddress,
            1_700_000_000,
            [1, 2, 3],
            "0x1234",
          ],
        }),
      );
    });
    vi.clearAllMocks();
    await queue.drain(true);
    await queue.clean(0, 1000, "completed");
    await queue.clean(0, 1000, "failed");
  });

  it("withdraws from panda for the refund wallet", async () => {
    webhook("wh-authorized", { amount: 500, authorizedAmount: 1500, status: "pending" });

    await jobFinished("wh-authorized");

    expect(mocks.getWallet).toHaveBeenCalledExactlyOnceWith(`${stack}-refunder`);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://panda.test/issuing/webhooks/wh-authorized"),
      expect.objectContaining({ headers: expect.objectContaining({ "Api-Key": "panda" }) as unknown, method: "GET" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        `/issuing/tenants/signatures/withdrawals?token=0x29684075a3C86ea11D9964BcAf0F956e801396bD&amount=1000&recipientAddress=${refunderAddress}&adminAddress=${account}&chainId=84532`,
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
        address: "0x54d02DcB38B76A67dC9368D8457D1F384B865c70",
        args: [account, account, 1000n, refunderAddress, 1_700_000_000n, toHex(Buffer.from([1, 2, 3])), "0x1234"],
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
    expect(vi.mocked(continueTrace)).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("withdraws reversed authorization updates", async () => {
    webhook(
      "wh-reversed",
      { authorizationUpdateAmount: -2000, authorizedAt: "2026-01-01T00:00:00.000Z", status: "reversed" },
      "updated",
    );

    await jobFinished("wh-reversed");

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("&amount=2000&"), expect.anything());
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({
        args: [account, account, 2000n, refunderAddress, 1_700_000_000n, "0x010203", "0x1234"],
      }),
    );
  });

  it("withdraws negative completed spends", async () => {
    webhook(
      "wh-negative",
      {
        amount: -3000,
        authorizedAt: "2026-01-01T00:00:00.000Z",
        postedAt: "2026-01-01T00:00:00.000Z",
        status: "completed",
      },
      "completed",
    );

    await jobFinished("wh-negative");

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("&amount=3000&"), expect.anything());
    expect(mocks.exaSend).toHaveBeenCalledOnce();
  });

  it("fails when refund amount is not found", async () => {
    webhook("wh-missing", { status: "pending" }, "created");

    await expect(jobFinished("wh-missing")).rejects.toThrow("refund amount not found");

    expect(mocks.getWallet).not.toHaveBeenCalled();
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(
      expect.objectContaining({ message: "refund amount not found" }),
      {
        level: "error",
        tags: { queue: "refund", job: "refund" },
        extra: { attempts: 1, id: "wh-missing", recipient: refunderAddress },
      },
    );
  });

  it("fails when refund amount is not positive", async () => {
    webhook("wh-zero", { amount: 500, authorizedAmount: 500, status: "pending" });

    await expect(jobFinished("wh-zero")).rejects.toThrow("refund amount not found");

    expect(mocks.exaSend).not.toHaveBeenCalled();
  });

  it("fails on non-transaction webhooks", async () => {
    webhooks.set("wh-dispute", {
      id: "wh-dispute",
      requestBody: { resource: "dispute", action: "created", body: { id: "dispute" }, id: "wh-dispute" },
      requestSentAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(jobFinished("wh-dispute")).rejects.toThrow("unexpected resource");

    expect(mocks.getWallet).not.toHaveBeenCalled();
    expect(mocks.exaSend).not.toHaveBeenCalled();
  });

  it("retries panda withdrawal failures", async () => {
    webhook("wh-retry", { amount: 500, authorizedAmount: 1500, status: "pending" });
    mocks.exaSend.mockRejectedValueOnce(new Error("panda down")).mockResolvedValueOnce({});

    await jobFinished("wh-retry", { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("captures terminal failures", async () => {
    webhook("wh-terminal", { amount: 500, authorizedAmount: 1500, status: "pending" });
    const error = new Error("withdraw failed");
    mocks.exaSend.mockRejectedValueOnce(error);

    await expect(jobFinished("wh-terminal", { removeOnFail: false })).rejects.toThrow("withdraw failed");

    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState("wh-terminal")).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe("wh-terminal");
    expect(job.failedReason).toBe("withdraw failed");
    expect(job.attemptsMade).toBe(1);
    expect(job.stacktrace).toHaveLength(1);
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, {
      level: "error",
      tags: { queue: "refund", job: "refund" },
      extra: { attempts: 1, id: "wh-terminal", recipient: refunderAddress },
    });
    await job.remove();
  });

  it("captures panda webhook rejections", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("panda error", { status: 502 }));

    await expect(jobFinished("wh-panda-down")).rejects.toThrow("panda error");

    expect(mocks.getWallet).not.toHaveBeenCalled();
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Panda502", message: "panda error", status: 502, cause: "panda error" }),
      {
        level: "error",
        tags: { queue: "refund", job: "refund" },
        extra: { attempts: 1, id: "wh-panda-down", recipient: refunderAddress },
      },
    );
  });

  it("captures non-error failures", async () => {
    vi.mocked(fetch).mockRejectedValueOnce("panda unavailable");

    await expect(jobFinished("wh-non-error")).rejects.toBeDefined();

    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(expect.anything(), {
      level: "error",
      tags: { queue: "refund", job: "refund" },
      extra: { attempts: 1, id: "wh-non-error", recipient: refunderAddress },
    });
  });

  it("continues sentry traces", async () => {
    webhook("wh-trace", { amount: 500, authorizedAmount: 1500, status: "pending" });

    await jobFinished("wh-trace", undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(vi.mocked(continueTrace)).toHaveBeenCalledWith(
      { sentryTrace: "trace", baggage: "baggage" },
      expect.any(Function),
    );
  });

  it("continues sentry traces with baggage only", async () => {
    webhook("wh-baggage", { amount: 500, authorizedAmount: 1500, status: "pending" });

    await jobFinished("wh-baggage", undefined, { sentryBaggage: "baggage" });

    expect(vi.mocked(continueTrace)).toHaveBeenCalledWith(
      { sentryTrace: undefined, baggage: "baggage" },
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
      extra: { attempts: undefined, id: undefined, recipient: refunderAddress },
    });
  });

  it("skips intermediate failed events", async () => {
    webhook("wh-intermediate", { amount: 500, authorizedAmount: 1500, status: "pending" });
    const error = new Error("intermediate failure");
    mocks.exaSend.mockRejectedValue(error);

    await expect(jobFinished("wh-intermediate", { attempts: 2, backoff: { type: "fixed", delay: 1 } })).rejects.toThrow(
      "intermediate failure",
    );

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "refund", job: "refund" },
      extra: { attempts: 2, id: "wh-intermediate", recipient: refunderAddress },
    });
  });
});

const mocks = vi.hoisted(() => ({
  exaSend: vi.fn(),
  getWallet: vi.fn(),
}));

vi.mock("../../utils/wallet", () => ({
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

function webhook(id: string, spend: Record<string, unknown>, action = "requested") {
  webhooks.set(id, {
    id,
    requestBody: {
      id,
      resource: "transaction",
      action,
      body: {
        id: "tx",
        type: "spend",
        spend: {
          amount: 0,
          currency: "usd",
          cardId: "card",
          cardType: "virtual",
          localAmount: 0,
          localCurrency: "usd",
          merchantCountry: "AR",
          merchantCategoryCode: "5411",
          merchantName: "merchant",
          userId: "user",
          ...spend,
        },
      },
    },
    requestSentAt: "2026-01-01T00:00:00.000Z",
  });
}

async function jobFinished(id: string, options?: JobsOptions, trace?: Pick<Refund, "sentryBaggage" | "sentryTrace">) {
  const job = await queue.add(
    "refund",
    { ...trace },
    { attempts: 1, jobId: id, removeOnComplete: true, removeOnFail: true, ...options },
  );
  await job.waitUntilFinished(events).catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
}
