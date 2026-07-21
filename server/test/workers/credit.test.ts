import "../mocks/onesignal";
import "../mocks/sentry";

import { DefaultApi } from "@onesignal/node-onesignal";
import { captureException, continueTrace, startSpan } from "@sentry/node";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { parse } from "valibot";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { cards, credentials } from "../../database";
import t from "../../i18n";
import * as onesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import { queue as connection } from "../../utils/redis";
import { close as closeQueue, enqueue } from "../../workers/credit/queue";
import { close, start } from "../../workers/credit/worker";

import type { Job as Credit } from "../../workers/credit/job";
import type { Job, JobsOptions } from "bullmq";

const account = parse(Address, "0xb12057309bdDd6e071d5AAF9714C5f15E02441D6");
const unknown = parse(Address, "0x1234567890123456789012345678901234567890");
const market = parse(Address, "0xafc70edeb980d345da3c76786d9689d41804b521");
const producer = new Queue<Credit, void, "credit">("credit", { connection });
let worker: Awaited<ReturnType<typeof start>>;

function done(current: Address, options?: JobsOptions, trace?: Pick<Credit, "sentryBaggage" | "sentryTrace">) {
  return new Promise<void>((resolve, reject) => {
    const completed = (job: Job<Credit>) => {
      if (job.data.account !== current) return;
      cleanup();
      resolve();
    };
    const failed = (job: Job<Credit> | undefined, error: Error) => {
      if (job?.data.account !== current) return;
      if (job.attemptsMade < (options?.attempts ?? 1)) return;
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
      .add("credit", { account: current, ...trace }, { attempts: 1, removeOnComplete: true, ...options })
      .catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error("queue add failed", { cause: error }));
      });
  });
}

function queued() {
  return new Promise<void>((resolve, reject) => {
    const completed = (job: Job<Credit>) => {
      if (job.data.account !== account) return;
      cleanup();
      resolve();
    };
    const failed = (job: Job<Credit> | undefined, error: Error) => {
      if (job?.data.account !== account) return;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off("completed", completed);
      worker.off("failed", failed);
    };
    worker.on("completed", completed);
    worker.on("failed", failed);
    enqueue(account).catch((error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error("queue add failed", { cause: error }));
    });
  });
}

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
  const postgresUrl = process.env.POSTGRES_URL;
  if (!postgresUrl) throw new Error("missing postgres url");
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("missing redis url");
  worker = start({ onesignalKey: "onesignal", postgresUrl, redisUrl });
  vi.spyOn(onesignal, "sendPushNotification").mockResolvedValue({} as never);
  vi.spyOn(publicClient, "readContract").mockResolvedValue([] as never);
  vi.clearAllMocks();
  await database.update(cards).set({ mode: 0, status: "ACTIVE" }).where(eq(cards.id, "credit-card"));
  await producer.drain(true);
  await producer.clean(0, 1000, "completed");
  await producer.clean(0, 1000, "failed");
});

afterAll(async () => {
  await database.delete(cards).where(eq(cards.credentialId, "credit-worker"));
  await database.delete(credentials).where(eq(credentials.id, "credit-worker"));
  await Promise.all([producer.close(), closeQueue(), close()]);
});

describe("credit queue", () => {
  it("publishes automatic credit jobs", async () => {
    const pending = Symbol("pending");
    const deferred = Promise.withResolvers<QueueJob>();
    const add = vi.spyOn(Queue.prototype, "add").mockReturnValue(deferred.promise);
    const result = enqueue(account);

    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(await Promise.race([result, Promise.resolve(pending)])).toBe(pending);
    deferred.resolve({ id: account, data: { account } } as unknown as QueueJob);

    await expect(result).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledExactlyOnceWith(
      "credit",
      expect.objectContaining({
        account,
        sentryBaggage: expect.any(String) as string,
        sentryTrace: expect.any(String) as string,
      }),
      { jobId: account },
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "credit", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await expect(enqueue(account)).resolves.toBeUndefined();

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "credit", job: "credit" },
      extra: { account },
    });
  });
});

describe("credit worker", () => {
  it("automatically activates credit mode", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);

    await queued();

    await expect(database.query.cards.findFirst({ where: eq(cards.id, "credit-card") })).resolves.toMatchObject({
      mode: 1,
    });
    expect(onesignal.sendPushNotification).toHaveBeenCalledWith(
      {
        userId: account,
        headings: t("Credit mode activated"),
        contents: t("Your card is now in credit mode"),
      },
      expect.any(DefaultApi),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("keeps debit mode without deposits", async () => {
    await done(account);

    await expect(database.query.cards.findFirst({ where: eq(cards.id, "credit-card") })).resolves.toMatchObject({
      mode: 0,
    });
    expect(onesignal.sendPushNotification).not.toHaveBeenCalled();
  });

  it("ignores empty deposits", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 0n, market }] as never);

    await done(account);

    await expect(database.query.cards.findFirst({ where: eq(cards.id, "credit-card") })).resolves.toMatchObject({
      mode: 0,
    });
    expect(onesignal.sendPushNotification).not.toHaveBeenCalled();
  });

  it("keeps debit mode with usdc deposits", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([
      { floatingDepositAssets: 1n, market },
      { floatingDepositAssets: 1n, market: marketUSDCAddress },
    ] as never);

    await done(account);

    await expect(database.query.cards.findFirst({ where: eq(cards.id, "credit-card") })).resolves.toMatchObject({
      mode: 0,
    });
    expect(onesignal.sendPushNotification).not.toHaveBeenCalled();
  });

  it("does not change an existing credit mode", async () => {
    await database.update(cards).set({ mode: 1 }).where(eq(cards.id, "credit-card"));
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);

    await done(account);

    await expect(database.query.cards.findFirst({ where: eq(cards.id, "credit-card") })).resolves.toMatchObject({
      mode: 1,
    });
    expect(onesignal.sendPushNotification).not.toHaveBeenCalled();
  });

  it("does not change deleted cards", async () => {
    await database.update(cards).set({ status: "DELETED" }).where(eq(cards.id, "credit-card"));
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);

    await done(account);

    await expect(database.query.cards.findFirst({ where: eq(cards.id, "credit-card") })).resolves.toMatchObject({
      mode: 0,
    });
    expect(onesignal.sendPushNotification).not.toHaveBeenCalled();
  });

  it("does not change cards for unknown accounts", async () => {
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);

    await done(unknown);

    expect(onesignal.sendPushNotification).not.toHaveBeenCalled();
  });

  it("captures notification errors without retrying", async () => {
    const error = new Error("push failed");
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);
    vi.mocked(onesignal.sendPushNotification).mockRejectedValueOnce(error);

    await done(account);

    expect(captureException).toHaveBeenCalledWith(error);
    await expect(database.query.cards.findFirst({ where: eq(cards.id, "credit-card") })).resolves.toMatchObject({
      mode: 1,
    });
  });

  it("retries automatic credit failures", async () => {
    vi.mocked(publicClient.readContract)
      .mockRejectedValueOnce(new Error("rpc unavailable"))
      .mockResolvedValueOnce([{ floatingDepositAssets: 1n, market }] as never);

    await done(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(publicClient.readContract).toHaveBeenCalledTimes(2);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures terminal failures", async () => {
    const error = new Error("credit failed");
    vi.mocked(publicClient.readContract).mockRejectedValueOnce(error);

    await expect(done(account)).rejects.toThrow("credit failed");

    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { account, attempts: expect.any(Number) as number, id: expect.any(String) as string },
      level: "error",
      tags: { queue: "credit", job: "credit" },
    });
  });

  it("continues sentry traces", async () => {
    await done(account, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(continueTrace).toHaveBeenCalledWith({ sentryTrace: "trace", baggage: "baggage" }, expect.any(Function));
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.emit("error", error);

    expect(captureException).toHaveBeenCalledWith(error, { level: "error", tags: { queue: "credit" } });
  });

  it("captures failed events without a job", () => {
    const error = new Error("failed event error");

    worker.emit("failed", undefined, error, "active");

    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { account: undefined, attempts: undefined, id: undefined },
      level: "error",
      tags: { queue: "credit", job: undefined },
    });
  });

  it("skips intermediate failed events", () => {
    const error = new Error("failed event error");

    worker.emit(
      "failed",
      { attemptsMade: 9, data: { account }, name: "credit", opts: {} } as QueueJob,
      error,
      "active",
    );

    expect(captureException).not.toHaveBeenCalled();
  });
});

type QueueJob = Awaited<ReturnType<Queue<Credit, void, "credit">["add"]>>;
