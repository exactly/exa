import "../mocks/sentry";

import { captureException, continueTrace, setUser, startSpan } from "@sentry/node";
import { Queue, QueueEvents } from "bullmq";
import { createHmac, randomBytes } from "node:crypto";
import { env } from "node:process";
import { nonEmpty, object, parse, pipe, string } from "valibot";
import { padHex, zeroAddress, zeroHash } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { Address } from "@exactly/common/validation";

import database, { cards, credentials, sources, transactions } from "../../database";
import createPanda from "../../utils/panda";
import { bullmq } from "../../utils/redis";
import createHook from "../../workers/hook/queue";
import hookWorker from "../../workers/hook/worker";
import { connect } from "../../workers/worker";

import type * as P from "../../utils/panda";
import type { Job as Hook } from "../../workers/hook/job";
import type * as C from "@exactly/common/generated/chain";
import type { JobsOptions } from "bullmq";

const secret = randomBytes(16).toString("hex");
const routedSecret = randomBytes(16).toString("hex");
const redisUrl = parse(pipe(string(), nonEmpty()), env.REDIS_URL);
const hook = createHook(bullmq);
const queue = new Queue<Hook, void, "hook">("hook", { connection: bullmq });
const events = new QueueEvents("hook", { connection: bullmq });
const webhooks = new Map<string, unknown>();

let worker: ReturnType<typeof hookWorker>;
let connection: ReturnType<typeof connect>;

afterAll(async () => {
  await Promise.all([queue.close(), events.close(), hook.close()]);
  await database.$client.end();
});

describe("hook queue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("publishes hook jobs", async () => {
    await hook.enqueue({ receipt: { blockNumber: 7, transactionHash: "0x1234" } }, "wk-queue");

    const job = await queue.getJob("wk-queue");
    if (!job) throw new Error("job not found");

    expect(job.id).toBe("wk-queue");
    expect(job.name).toBe("hook");
    expect(job.data).toStrictEqual({
      receipt: { blockNumber: 7, transactionHash: "0x1234" },
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(job.opts).toStrictEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 500 },
      jobId: "wk-queue",
      removeOnComplete: true,
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    });
    await expect(job.getState()).resolves.toBe("waiting");
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "hook", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
    await job.remove();
  });

  it("uses more attempts on mainnet", async () => {
    vi.resetModules();
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => {
      const original = await importOriginal<typeof C>();
      return { ...original, default: { ...original.default, testnet: false } };
    });

    try {
      const { attempts } = await import("../../workers/hook/job");

      expect(attempts).toBe(20);
    } finally {
      vi.doUnmock("@exactly/common/generated/chain");
      vi.resetModules();
    }
  });

  it("propagates queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    const result = hook.enqueue({}, "wk-queue-failure");

    await expect(result).rejects.toThrow(error);
    await expect(queue.getJob("wk-queue-failure")).resolves.toBeUndefined();
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("hook worker", () => {
  beforeAll(async () => {
    await queue.drain(true);
    await database.transaction(async (tx) => {
      await tx.insert(sources).values([
        {
          id: "webhook-source",
          config: { type: "uphold", webhooks: { sandbox: { url: "https://exa.test", secret } } },
        },
        {
          id: "webhook-multi",
          config: {
            type: "integrator",
            webhooks: {
              sandbox: { url: "https://exa.test", secret },
              routed: {
                url: "https://routed.test",
                secret: routedSecret,
                transaction: { created: "https://routed.test/tx" },
                card: { updated: "https://routed.test/card" },
                user: { updated: "https://routed.test/user" },
              },
            },
          },
        },
        { id: "webhook-broken", config: { type: "uphold" } },
      ]);
      await tx.insert(credentials).values([
        {
          id: "webhook-cred",
          publicKey: new Uint8Array(),
          account: parse(Address, padHex("0xfab1", { size: 20 })),
          factory: zeroAddress,
          pandaId: "webhook-user",
          source: "webhook-source",
        },
        {
          id: "webhook-cred-multi",
          publicKey: new Uint8Array(),
          account: parse(Address, padHex("0xfab2", { size: 20 })),
          factory: zeroAddress,
          pandaId: "webhook-user-multi",
          source: "webhook-multi",
        },
        {
          id: "webhook-cred-broken",
          publicKey: new Uint8Array(),
          account: parse(Address, padHex("0xfab3", { size: 20 })),
          factory: zeroAddress,
          pandaId: "webhook-user-broken",
          source: "webhook-broken",
        },
        {
          id: "webhook-cred-sourceless",
          publicKey: new Uint8Array(),
          account: parse(Address, padHex("0xfab4", { size: 20 })),
          factory: zeroAddress,
          pandaId: "webhook-user-sourceless",
        },
      ]);
      await tx.insert(cards).values([{ id: "webhook-card", credentialId: "webhook-cred", lastFour: "1234" }]);
    });
    connection = connect(redisUrl);
    worker = hookWorker({
      bullmq: connection,
      database,
      panda: createPanda({ key: "panda", url: "https://panda.test" }),
    });
    await worker.ready;
  });

  afterAll(async () => {
    await worker.close();
    await connection.quit();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    webhooks.clear();
    mocks.getWebhook.mockReset().mockImplementation((id) => Promise.resolve(webhooks.get(id)));
    vi.clearAllMocks();
    await queue.drain(true);
    await queue.clean(0, 1000, "completed");
    await queue.clean(0, 1000, "failed");
  });

  it("delivers transaction created webhooks", async () => {
    transaction("wk-created", { exchangeRate: 1.17 });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-created");

    expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
      "https://exa.test",
      expect.objectContaining({ method: "POST", redirect: "error", signal: expect.any(AbortSignal) as AbortSignal }),
    );
    const options = mockFetch.mock.calls[0]?.[1];
    const headers = parse(object({ Signature: string() }), options?.headers);
    const body = parse(string(), options?.body);
    expect(createHmac("sha256", secret).update(body).digest("hex")).toBe(headers.Signature);
    expect(JSON.parse(body)).toStrictEqual({
      id: "wk-created",
      timestamp: expect.any(String) as string,
      resource: "transaction",
      action: "created",
      body: { id: "tx-wk-created", type: "spend", spend: { ...spend, exchangeRate: 1.17 } },
    });
    expect(webhookLogger).toHaveBeenCalledExactlyOnceWith("%j", expect.objectContaining({ code: 200, response: "OK" }));
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: parse(Address, padHex("0xfab1", { size: 20 })) });
    expect(continueTrace).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("delivers without exchange rate on matching currencies", async () => {
    transaction("wk-same", { localAmount: 100, localCurrency: "usd" });
    const mockFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(Response.json({ code: "ok" })));

    await jobFinished("wk-same");

    const body = parse(string(), mockFetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toStrictEqual({
      id: "wk-same",
      timestamp: expect.any(String) as string,
      resource: "transaction",
      action: "created",
      body: { id: "tx-wk-same", type: "spend", spend: { ...spend, localAmount: 100, localCurrency: "usd" } },
    });
    expect(webhookLogger).toHaveBeenCalledExactlyOnceWith(
      "%j",
      expect.objectContaining({ code: 200, response: { code: "ok" } }),
    );
  });

  it("delivers transaction updated webhooks", async () => {
    transaction("wk-updated", { authorizationUpdateAmount: -2000, exchangeRate: 1.17, status: "reversed" }, "updated");
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-updated");

    const body = parse(string(), mockFetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toStrictEqual({
      id: "wk-updated",
      timestamp: expect.any(String) as string,
      resource: "transaction",
      action: "updated",
      body: {
        id: "tx-wk-updated",
        type: "spend",
        spend: { ...spend, authorizationUpdateAmount: -2000, status: "reversed" },
      },
    });
  });

  it("delivers transaction completed webhooks with receipts", async () => {
    transaction("wk-completed", { exchangeRate: 1.17, status: "completed" }, "completed");
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-completed", undefined, { receipt: { blockNumber: 7, transactionHash: "0x1234" } });

    const body = parse(string(), mockFetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toStrictEqual({
      id: "wk-completed",
      timestamp: expect.any(String) as string,
      resource: "transaction",
      action: "completed",
      receipt: { blockNumber: 7, transactionHash: "0x1234" },
      body: { id: "tx-wk-completed", type: "spend", spend: { ...spend, status: "completed", exchangeRate: 1.17 } },
    });
  });

  it("fans out to routed and fallback urls", async () => {
    transaction("wk-multi", { exchangeRate: 1.17, userId: "webhook-user-multi" });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-multi");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const sandbox = mockFetch.mock.calls.find(([url]) => url === "https://exa.test");
    const routed = mockFetch.mock.calls.find(([url]) => url === "https://routed.test/tx");
    if (!sandbox || !routed) throw new Error("missing webhook call");
    expect(createHmac("sha256", secret).update(parse(string(), sandbox[1]?.body)).digest("hex")).toBe(
      parse(object({ Signature: string() }), sandbox[1]?.headers).Signature,
    );
    expect(createHmac("sha256", routedSecret).update(parse(string(), routed[1]?.body)).digest("hex")).toBe(
      parse(object({ Signature: string() }), routed[1]?.headers).Signature,
    );
    expect(sandbox[1]?.body).toBe(routed[1]?.body);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: parse(Address, padHex("0xfab2", { size: 20 })) });
  });

  it.each([
    ["active", "ACTIVE"],
    ["locked", "FROZEN"],
    ["canceled", "DELETED"],
    ["notActivated", "INACTIVE"],
  ])("delivers card %s updates", async (status, mapped) => {
    card(`wk-card-${status}`, status);
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished(`wk-card-${status}`);

    const body = parse(string(), mockFetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toStrictEqual({
      id: `wk-card-${status}`,
      timestamp: expect.any(String) as string,
      resource: "card",
      action: "updated",
      body: {
        id: "card-1",
        last4: "1234",
        limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
        status: mapped,
        tokenWallets: ["Apple"],
      },
    });
  });

  it("routes card updates", async () => {
    card("wk-card-route", "active", "webhook-user-multi");
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-card-route");

    expect(mockFetch.mock.calls.map(([url]) => url).toSorted()).toStrictEqual([
      "https://exa.test",
      "https://routed.test/card",
    ]);
  });

  it("delivers user updates with credential ids", async () => {
    user("wk-user", "webhook-user");
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-user");

    const body = parse(string(), mockFetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toStrictEqual({
      id: "wk-user",
      timestamp: expect.any(String) as string,
      resource: "user",
      action: "updated",
      body: { credentialId: "webhook-cred", applicationReason: "", applicationStatus: "approved", isActive: true },
    });
  });

  it("routes user updates", async () => {
    user("wk-user-route", "webhook-user-multi");
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-user-route");

    expect(mockFetch.mock.calls.map(([url]) => url).toSorted()).toStrictEqual([
      "https://exa.test",
      "https://routed.test/user",
    ]);
  });

  it("delivers the saved local reason when panda sends webhook declined", async () => {
    await database.insert(transactions).values([
      {
        id: "tx-wk-reason",
        cardId: "webhook-card",
        hashes: [zeroHash],
        payload: {
          type: "panda",
          bodies: [{ action: "requested", body: { spend: { declinedReason: "frozenCard" } } }],
        },
      },
    ]);
    transaction("wk-reason", { declinedReason: "webhook declined", status: "declined" });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-reason");

    const body = parse(string(), mockFetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toMatchObject({ body: { spend: { declinedReason: "frozenCard", status: "declined" } } });
  });

  it("delivers the requested reason when the spend has none", async () => {
    await database.insert(transactions).values([
      {
        id: "tx-wk-requested-reason",
        cardId: "webhook-card",
        hashes: [zeroHash],
        payload: { type: "panda", bodies: [{ action: "requested", body: { spend: {} }, reason: "high risk" }] },
      },
    ]);
    transaction("wk-requested-reason", { declinedReason: "webhook declined", status: "declined" });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-requested-reason");

    const body = parse(string(), mockFetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toMatchObject({ body: { spend: { declinedReason: "high risk" } } });
  });

  it("keeps webhook declined without a transaction", async () => {
    transaction("wk-no-tx", { declinedReason: "webhook declined", status: "declined" });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-no-tx");

    const body = parse(string(), mockFetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toMatchObject({ body: { spend: { declinedReason: "webhook declined" } } });
  });

  it("keeps webhook declined without a requested body", async () => {
    await database.insert(transactions).values([
      {
        id: "tx-wk-no-requested",
        cardId: "webhook-card",
        hashes: [zeroHash],
        payload: { type: "panda", bodies: [{ action: "created", body: { spend: {} } }] },
      },
    ]);
    transaction("wk-no-requested", { declinedReason: "webhook declined", status: "declined" });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-no-requested");

    const body = parse(string(), mockFetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toMatchObject({ body: { spend: { declinedReason: "webhook declined" } } });
  });

  it("keeps other declined reasons", async () => {
    transaction("wk-blocked", { declinedReason: "blocked mcc", status: "declined" });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-blocked");

    const body = parse(string(), mockFetch.mock.calls[0]?.[1]?.body);
    expect(JSON.parse(body)).toMatchObject({ body: { spend: { declinedReason: "blocked mcc" } } });
  });

  it("skips requested transactions", async () => {
    transaction("wk-requested", {}, "requested");
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-requested");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips disputes", async () => {
    webhooks.set("wk-dispute", {
      id: "wk-dispute",
      requestBody: { resource: "dispute", action: "created", body: { id: "dispute" }, id: "wk-dispute" },
      requestSentAt: "2026-01-01T00:00:00.000Z",
    });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-dispute");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips card notifications", async () => {
    webhooks.set("wk-notification", {
      id: "wk-notification",
      requestBody: {
        id: "wk-notification",
        resource: "card",
        action: "notification",
        body: {
          id: "notification",
          card: { id: "card-1", userId: "webhook-user" },
          tokenWallet: "Apple",
          reasonCode: "PROVISIONING_DECLINED",
        },
      },
      requestSentAt: "2026-01-01T00:00:00.000Z",
    });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-notification");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips unknown users", async () => {
    transaction("wk-ghost", { userId: "webhook-ghost" });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-ghost");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips sourceless users", async () => {
    transaction("wk-sourceless", { userId: "webhook-user-sourceless" });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-sourceless");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: parse(Address, padHex("0xfab4", { size: 20 })) });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("fails without retries on invalid job data", async () => {
    const result = jobFinished("wk-bad-data", { attempts: 2, backoff: { type: "fixed", delay: 1 } }, {
      receipt: "bad",
    } as unknown as Hook);

    await expect(result).rejects.toBeDefined();
    expect(mocks.getWebhook).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "UnrecoverableError",
        cause: expect.objectContaining({ name: "ValiError" }) as unknown,
      }),
      expect.objectContaining({ level: "fatal", fingerprint: ["{{ default }}", "hook.exhausted"] }),
    );
  });

  it("fails without retries on invalid configs", async () => {
    transaction("wk-bad-config", { userId: "webhook-user-broken" });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    const result = jobFinished("wk-bad-config", { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    await expect(result).rejects.toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith({ id: parse(Address, padHex("0xfab3", { size: 20 })) });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "UnrecoverableError",
        cause: expect.objectContaining({ name: "ValiError" }) as unknown,
      }),
      expect.objectContaining({ level: "fatal", fingerprint: ["{{ default }}", "hook.exhausted"] }),
    );
  });

  it("fails without retries on invalid webhook bodies", async () => {
    webhooks.set("wk-bad-body", {
      id: "wk-bad-body",
      requestBody: {
        id: "wk-bad-body",
        resource: "card",
        action: "updated",
        body: {
          id: "card-1",
          userId: "webhook-user",
          limit: { amount: 1, frequency: "per7DayPeriod" },
          status: "active",
        },
      },
      requestSentAt: "2026-01-01T00:00:00.000Z",
    });
    const mockFetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    const result = jobFinished("wk-bad-body", { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    await expect(result).rejects.toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        name: "UnrecoverableError",
        cause: expect.objectContaining({ name: "ValiError" }) as unknown,
      }),
      expect.objectContaining({ level: "fatal", fingerprint: ["{{ default }}", "hook.exhausted"] }),
    );
  });

  it("retries failed deliveries", async () => {
    transaction("wk-retry", {});
    const mockFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(new Response("oops", { status: 500 })))
      .mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-retry", { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(webhookLogger).toHaveBeenCalledWith("%j", expect.objectContaining({ code: 500, response: "oops" }));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures terminal delivery failures", async () => {
    transaction("wk-terminal", {});
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({ code: "err" }, { status: 500 })),
    );

    const result = jobFinished("wk-terminal", { removeOnFail: false });

    await expect(result).rejects.toThrow("webhook failed");
    await expect(queue.getJobState("wk-terminal")).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.failedReason).toBe("webhook failed");
    expect(webhookLogger).toHaveBeenCalledExactlyOnceWith(
      "%j",
      expect.objectContaining({ code: 500, response: { code: "err" } }),
    );
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "webhook failed" }), {
      level: "fatal",
      fingerprint: ["{{ default }}", "hook.exhausted"],
      tags: { queue: "hook", job: "hook" },
      extra: { attempts: 1, id: "wk-terminal" },
    });
    await job.remove();
  });

  it("delivers remaining targets on partial failures", async () => {
    transaction("wk-partial", { userId: "webhook-user-multi" });
    const routed = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(() => Promise.resolve(new Response("oops", { status: 500 })))
      .mockImplementation(() => Promise.resolve(new Response("OK")));
    const mockFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url) => (url === "https://routed.test/tx" ? routed() : Promise.resolve(new Response("OK"))));

    await jobFinished("wk-partial", { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(mockFetch.mock.calls.map(([url]) => url).toSorted()).toStrictEqual([
      "https://exa.test",
      "https://routed.test/tx",
      "https://routed.test/tx",
    ]);
    expect(webhookLogger).toHaveBeenCalledWith("%j", expect.objectContaining({ code: 500, response: "oops" }));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("logs delivery errors", async () => {
    transaction("wk-error", {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));

    const result = jobFinished("wk-error");

    await expect(result).rejects.toThrow("webhook failed");
    expect(webhookLogger).toHaveBeenCalledExactlyOnceWith("%j", expect.objectContaining({ error: "boom" }));
  });

  it("skips logging non-error delivery failures", async () => {
    transaction("wk-non-error", {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue("boom");

    const result = jobFinished("wk-non-error");

    await expect(result).rejects.toThrow("webhook failed");
    expect(webhookLogger).not.toHaveBeenCalled();
  });

  it("continues sentry traces", async () => {
    transaction("wk-trace", {});
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("OK")));

    await jobFinished("wk-trace", undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(continueTrace).toHaveBeenCalledWith({ sentryTrace: "trace", baggage: "baggage" }, expect.any(Function));
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.queue.emit("error", error);

    expect(captureException).toHaveBeenCalledWith(error, { level: "error", tags: { queue: "hook" } });
  });

  it("captures failed events without a job", () => {
    const error = new Error("failed event error");

    worker.queue.emit("failed", undefined, error, "active");

    expect(captureException).toHaveBeenCalledWith(error, {
      level: "fatal",
      fingerprint: ["{{ default }}", "hook.exhausted"],
      tags: { queue: "hook", job: undefined },
      extra: { attempts: undefined, id: undefined },
    });
  });
});

const spend = {
  amount: 100,
  currency: "usd",
  cardId: "webhook-card",
  localAmount: 85,
  localCurrency: "eur",
  merchantCountry: "AR",
  merchantCategoryCode: "5411",
  merchantName: "merchant",
  authorizedAt: "2026-01-01T00:00:00.000Z",
  status: "pending",
};

const mocks = vi.hoisted(() => ({ getWebhook: vi.fn<(id: string) => Promise<unknown>>() }));

vi.mock("../../utils/panda", async (importOriginal) => {
  const original = await importOriginal<typeof P>();
  return {
    ...original,
    default: ((options) => ({ ...original.default(options), getWebhook: mocks.getWebhook })) as typeof original.default,
  };
});

const webhookLogger = vi.hoisted(() => vi.fn());

vi.mock("debug", () => ({
  default: vi.fn((namespace: string) => (namespace === "exa:webhook" ? webhookLogger : vi.fn())),
}));

function transaction(id: string, override: Record<string, unknown>, action = "created") {
  webhooks.set(id, {
    id,
    requestBody: {
      id,
      resource: "transaction",
      action,
      body: { id: `tx-${id}`, type: "spend", spend: { ...spend, userId: "webhook-user", ...override } },
    },
    requestSentAt: "2026-01-01T00:00:00.000Z",
  });
}

function card(id: string, status: string, userId = "webhook-user") {
  webhooks.set(id, {
    id,
    requestBody: {
      id,
      resource: "card",
      action: "updated",
      body: {
        id: "card-1",
        userId,
        last4: "1234",
        limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
        status,
        tokenWallets: ["Apple"],
      },
    },
    requestSentAt: "2026-01-01T00:00:00.000Z",
  });
}

function user(id: string, pandaId: string) {
  webhooks.set(id, {
    id,
    requestBody: {
      id,
      resource: "user",
      action: "updated",
      body: { id: pandaId, applicationReason: "", applicationStatus: "approved", isActive: true },
    },
    requestSentAt: "2026-01-01T00:00:00.000Z",
  });
}

async function jobFinished(id: string, options?: JobsOptions, data: Hook = {}) {
  const job = await queue.add("hook", data, {
    attempts: 1,
    jobId: id,
    removeOnComplete: true,
    removeOnFail: true,
    ...options,
  });
  await job.waitUntilFinished(events).catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
}
