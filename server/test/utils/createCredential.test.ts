import customer from "../mocks/sardine";
import "../mocks/sentry";

import { captureException, continueTrace, getActiveSpan, startSpan } from "@sentry/node";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { setSignedCookie } from "hono/cookie";
import { parse } from "valibot";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { credentials } from "../../database";
import createCredential, { closeQueue, startQueue, type Subscription } from "../../utils/createCredential";
import { close as closeRedis, queue as redisConnection } from "../../utils/redis";

import type { Job, JobsOptions } from "bullmq";

const mocks = vi.hoisted(() => ({ domain: "sandbox.exactly.app", webhookId: "webhook-id" as string | undefined }));

vi.mock("@exactly/common/domain", () => ({
  get default() {
    return mocks.domain;
  },
}));
vi.mock("hono/cookie", () => ({ setSignedCookie: vi.fn() }));
vi.mock("../../hooks/activity", () => ({
  get webhookId() {
    return mocks.webhookId;
  },
}));
vi.mock("../../utils/authSecret", () => ({ default: "secret" }));
vi.mock("../../utils/segment", () => ({ identify: vi.fn() }));

const credentialId = "0x1234567890123456789012345678901234567888";
const account = parse(Address, "0xb12057309bdDd6e071d5AAF9714C5f15E02441D6");
const next = parse(Address, "0xaFc70EDeb980D345dA3C76786D9689D41804B521");
const producer = new Queue<Subscription, void, "subscribe">("account", { connection: redisConnection });
let worker: Awaited<ReturnType<typeof startQueue>>;

function credential(source?: string) {
  return new Hono()
    .onError((error) => {
      throw error;
    })
    .post("/", async (c) => {
      await createCredential(c, credentialId, { source });
      return c.body(null);
    })
    .request("/", { method: "POST" });
}

function jobDone(
  current: Address,
  options?: JobsOptions,
  onFailed?: () => void,
  trace?: Pick<Subscription, "sentryBaggage" | "sentryTrace">,
) {
  return new Promise<void>((resolve, reject) => {
    let failures = 0;
    const completed = (job: Job<Subscription>) => {
      if (job.data.account !== current) return;
      cleanup();
      resolve();
    };
    const failed = (job: Job<Subscription> | undefined, error: Error) => {
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
        "subscribe",
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
  await database.delete(credentials).where(eq(credentials.id, credentialId));
  await producer.close();
  await closeQueue();
  await closeRedis();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createCredential", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.domain = "sandbox.exactly.app";
    await database.delete(credentials).where(eq(credentials.id, credentialId));
  });

  it("creates a credential and enqueues account subscription", async () => {
    const add = vi
      .spyOn(Queue.prototype, "add")
      .mockResolvedValue({ id: "subscribe", data: { account } } as AccountJob);

    const response = await credential();

    expect(response.status).toBe(200);
    const row = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true, factory: true, id: true, source: true },
    });
    if (!row) throw new Error("missing credential");
    expect(add).toHaveBeenCalledExactlyOnceWith(
      "subscribe",
      expect.objectContaining({
        account: row.account,
        sentryBaggage: expect.any(String) as string,
        sentryTrace: expect.any(String) as string,
      }),
      { jobId: row.account },
    );
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "account subscribe", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(row).toStrictEqual({
      account: row.account,
      factory: exaAccountFactoryAddress,
      id: credentialId,
      source: null,
    });
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("uses the active sentry span when one exists", async () => {
    vi.mocked(getActiveSpan).mockReturnValueOnce({} as NonNullable<ReturnType<typeof getActiveSpan>>);
    const add = vi
      .spyOn(Queue.prototype, "add")
      .mockResolvedValue({ id: "subscribe", data: { account } } as AccountJob);

    const response = await credential();

    expect(response.status).toBe(200);
    expect(add).toHaveBeenCalledOnce();
    expect(vi.mocked(startSpan)).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "account subscribe producer" }),
      expect.any(Function),
    );
  });

  it("captures queue enqueue failures after creating the credential", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    const response = await credential("test");

    expect(response.status).toBe(200);
    const row = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true, source: true },
    });
    if (!row) throw new Error("missing credential");
    expect(row.source).toBe("test");
    await vi.waitFor(() =>
      expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, {
        level: "warning",
        tags: { queue: "account", job: "subscribe", fallback: "succeeded" },
        extra: { account: row.account },
      }),
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  });

  it("captures queue enqueue and fallback failures after creating the credential", async () => {
    const error = new Error("queue error");
    const fallback = new Error("alchemy error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(fallback);

    const response = await credential();

    expect(response.status).toBe(200);
    const row = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true },
    });
    if (!row) throw new Error("missing credential");
    await vi.waitFor(() =>
      expect(vi.mocked(captureException)).toHaveBeenCalledWith(expect.any(AggregateError), {
        level: "error",
        tags: { queue: "account", job: "subscribe", fallback: "failed" },
        extra: { account: row.account },
      }),
    );
    const captured = vi.mocked(captureException).mock.calls.find(([value]) => value instanceof AggregateError)?.[0];
    if (!(captured instanceof AggregateError)) throw new Error("missing aggregate error");
    expect(captured).toBeInstanceOf(AggregateError);
    expect(captured.errors).toStrictEqual([error, fallback]);
  });

  it("captures sardine failures after creating the credential", async () => {
    const error = new Error("sardine error");
    vi.mocked(customer).mockRejectedValueOnce(error);
    vi.spyOn(Queue.prototype, "add").mockResolvedValue({ id: "subscribe" } as AccountJob);

    const response = await credential();

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, { level: "error" }));
  });

  it("sets local cookie options on localhost", async () => {
    mocks.domain = "localhost";
    vi.spyOn(Queue.prototype, "add").mockResolvedValue({ id: "subscribe" } as AccountJob);

    const response = await credential();

    expect(response.status).toBe(200);
    expect(vi.mocked(setSignedCookie)).toHaveBeenCalledWith(
      expect.anything(),
      "credential_id",
      credentialId,
      "secret",
      { expires: expect.any(Date) as Date, httpOnly: true, sameSite: "lax", secure: false },
    );
  });

  it("rejects bad credentials", async () => {
    await expect(
      new Hono()
        .onError((error) => {
          throw error;
        })
        .post("/", async (c) => {
          await createCredential(c, "bad");
          return c.body(null);
        })
        .request("/", { method: "POST" }),
    ).rejects.toThrow("bad credential");
  });
});

describe("account queue", () => {
  beforeEach(async () => {
    worker = startQueue();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    vi.clearAllMocks();
    mocks.webhookId = "hook-a";
    await producer.drain(true);
    await producer.clean(0, 1000, "completed");
    await producer.clean(0, 1000, "failed");
  });

  it("subscribes an account to active webhooks", async () => {
    await jobDone(account);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodies()).toStrictEqual([{ webhook_id: "hook-a", addresses_to_add: [account], addresses_to_remove: [] }]);
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({
        forceTransaction: true,
        name: "account subscribe consumer",
      }),
      expect.any(Function),
    );
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "account subscribe",
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
      tags: { queue: "account", job: "subscribe" },
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
      tags: { queue: "account", job: "subscribe" },
      extra: {
        account,
        attempts: expect.any(Number) as number,
        id: expect.any(String) as string,
      },
    });
  });

  it("resolves active webhook again on retry", async () => {
    mocks.webhookId = undefined;

    await jobDone(next, { attempts: 2, backoff: { type: "fixed", delay: 1 } }, () => {
      mocks.webhookId = "hook-a";
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodies()).toStrictEqual([{ webhook_id: "hook-a", addresses_to_add: [next], addresses_to_remove: [] }]);
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.emit("error", error);

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, { level: "error", tags: { queue: "account" } });
  });

  it("captures failed events without a job", () => {
    const error = new Error("failed event error");

    worker.emit("failed", undefined, error, "active");

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(error, {
      level: "error",
      tags: { queue: "account", job: undefined },
      extra: { account: undefined, attempts: undefined, id: undefined },
    });
  });

  it("skips intermediate failed events with default attempts", () => {
    const error = new Error("failed event error");

    worker.emit(
      "failed",
      { attemptsMade: 9, data: { account }, name: "subscribe", opts: {} } as AccountJob,
      error,
      "active",
    );

    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });
});

type AccountQueue = Queue<Subscription, void, "subscribe">;
type AccountJob = Awaited<ReturnType<AccountQueue["add"]>>;
