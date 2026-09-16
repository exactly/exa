import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/sentry";

import { captureException, continueTrace, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents } from "bullmq";
import { eq } from "drizzle-orm";
import { parse } from "valibot";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { cards, credentials } from "../../database";
import t from "../../i18n";
import createOnesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import { bullmq } from "../../utils/redis";
import createCredit from "../../workers/credit/queue";
import creditWorker from "../../workers/credit/worker";

import type { Job as Credit } from "../../workers/credit/job";
import type * as sentry from "@sentry/node";
import type { JobsOptions } from "bullmq";

const account = parse(Address, "0xb12057309bdDd6e071d5AAF9714C5f15E02441D6");
const unknown = parse(Address, "0x1234567890123456789012345678901234567890");
const market = parse(Address, "0xafc70edeb980d345da3c76786d9689d41804b521");
const credit = createCredit(bullmq);
const onesignal = createOnesignal("onesignal");
const queue = new Queue<Credit, void, "credit">("credit", { connection: bullmq });
const events = new QueueEvents("credit", { connection: bullmq });
let worker: ReturnType<typeof creditWorker>;

beforeAll(async () => {
  await database.insert(credentials).values({
    id: "credit-worker",
    account,
    factory: parse(Address, "0x9876543210987654321098765432109876543210"),
    publicKey: new Uint8Array(),
  });
  await database.insert(cards).values({ id: "credit-card", credentialId: "credit-worker", lastFour: "1234" });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  sendPushNotificationMock.mockResolvedValue({});
  vi.spyOn(publicClient, "readContract").mockResolvedValue([] as never);
  vi.clearAllMocks();
  await database.update(cards).set({ mode: 0, status: "ACTIVE" }).where(eq(cards.id, "credit-card"));
  await queue.drain(true);
  await queue.clean(0, 1000, "completed");
  await queue.clean(0, 1000, "failed");
});

afterAll(async () => {
  await database.delete(cards).where(eq(cards.credentialId, "credit-worker"));
  await database.delete(credentials).where(eq(credentials.id, "credit-worker"));
  await Promise.all([queue.close(), events.close(), credit.close()]);
});

describe("credit queue", () => {
  it("publishes automatic credit jobs", async () => {
    await expect(credit.enqueue(account)).resolves.toBeUndefined();

    const job = await queue.getJob(account);
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(account);
    expect(job.name).toBe("credit");
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
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "credit", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
    await job.remove();
  });

  it("propagates queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await expect(credit.enqueue(account)).rejects.toThrow(error);

    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("credit worker", () => {
  beforeAll(async () => {
    worker = creditWorker({ bullmq, database, onesignal });
    await worker.ready;
  });

  afterAll(async () => {
    await worker.close();
    await worker.close();
  });

  it("automatically activates credit mode", async () => {
    const setAttribute = await spySpanSetAttribute();
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);

    await jobFinished(account);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 1 });
    expect(sendPushNotificationMock).toHaveBeenCalledExactlyOnceWith({
      userId: account,
      headings: t("Credit mode activated"),
      contents: t("Your card is now in credit mode"),
    });
    expect(setAttribute.mock.calls.filter(([attribute]) => String(attribute).startsWith("exa."))).toStrictEqual([
      ["exa.autoCredit", true],
      ["exa.card", "credit-card"],
      ["exa.mode", 1],
    ]);
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ forceTransaction: true, name: "credit worker" }),
      expect.any(Function),
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "credit", op: "queue.process" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("keeps debit mode without deposits", async () => {
    await jobFinished(account);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 0 });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("ignores empty deposits", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 0n, market }] as never);

    await jobFinished(account);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 0 });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("keeps debit mode with usdc deposits", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([
      { floatingDepositAssets: 1n, market },
      { floatingDepositAssets: 1n, market: marketUSDCAddress },
    ] as never);

    await jobFinished(account);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 0 });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("does not change an existing credit mode", async () => {
    await database.update(cards).set({ mode: 1 }).where(eq(cards.id, "credit-card"));
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);

    await jobFinished(account);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 1 });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("does not change deleted cards", async () => {
    await database.update(cards).set({ status: "DELETED" }).where(eq(cards.id, "credit-card"));
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);

    await jobFinished(account);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 0 });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("does not change cards for unknown accounts", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);

    await jobFinished(unknown);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 0 });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("captures notification errors without retrying", async () => {
    const error = new Error("push failed");
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);
    sendPushNotificationMock.mockRejectedValueOnce(error);

    await jobFinished(account);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error);
    expect(publicClient.readContract).toHaveBeenCalledOnce();
    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 1 });
  });

  it("retries automatic credit failures", async () => {
    vi.mocked(publicClient.readContract)
      .mockRejectedValueOnce(new Error("rpc unavailable"))
      .mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);

    await jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(publicClient.readContract).toHaveBeenCalledTimes(2);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures persisted terminal failures", async () => {
    const error = new Error("credit failed");
    vi.mocked(publicClient.readContract).mockRejectedValueOnce(error);
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account, { removeOnFail: false })).rejects.toThrow("credit failed");

    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState(account)).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(account);
    expect(job.failedReason).toBe("credit failed");
    expect(job.attemptsMade).toBe(1);
    expect(job.stacktrace).toHaveLength(1);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 1, id: account },
      level: "error",
      tags: { queue: "credit", job: "credit" },
    });
    await job.remove();
  });

  it("captures only terminal failed events", async () => {
    const error = new Error("credit failed");
    vi.mocked(publicClient.readContract).mockRejectedValue(error);
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } })).rejects.toThrow(
      "credit failed",
    );

    expect(publicClient.readContract).toHaveBeenCalledTimes(2);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 2, id: account },
      level: "error",
      tags: { queue: "credit", job: "credit" },
    });
  });

  it("continues sentry traces", async () => {
    await jobFinished(account, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(continueTrace).toHaveBeenCalledWith({ sentryTrace: "trace", baggage: "baggage" }, expect.any(Function));
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.queue.emit("error", error);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error", tags: { queue: "credit" } });
  });

  it("captures failed events without a job", async () => {
    const error = new Error("failed event error");
    const setUser = await spyScopeSetUser();

    worker.queue.emit("failed", undefined, error, "active");

    expect(setUser).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account: undefined, attempts: undefined, id: undefined },
      level: "error",
      tags: { queue: "credit", job: undefined },
    });
  });
});

async function jobFinished(
  current: Address,
  options?: JobsOptions,
  trace?: Pick<Credit, "sentryBaggage" | "sentryTrace">,
) {
  const job = await queue.add(
    "credit",
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

async function spySpanSetAttribute() {
  const { startSpan: realStartSpan } = await vi.importActual<typeof sentry>("@sentry/node");
  const setAttribute = vi.fn();
  vi.mocked(startSpan).mockImplementation(((options, callback) =>
    realStartSpan(options, (span) => {
      const originalSetAttribute = span.setAttribute.bind(span);
      span.setAttribute = (...args: Parameters<typeof span.setAttribute>) => {
        setAttribute(...args);
        return originalSetAttribute(...args);
      };
      return callback(span);
    })) as typeof startSpan);
  return setAttribute;
}
