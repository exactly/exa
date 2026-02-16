import "../mocks/sardine";
import "../mocks/sentry";

import { captureException, startSpan } from "@sentry/node";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountJob, closeQueue, processor, type AccountJobData } from "../../utils/createCredential";
import createCredential, { WebhookNotReadyError } from "../../utils/createCredential";
import { close as closeRedis } from "../../utils/redis";

import type { Job } from "bullmq";
import type { Context } from "hono";

const mocks = vi.hoisted(() => ({
  webhookId: { value: "webhook-id" as string | undefined },
}));

vi.mock("hono/cookie", () => ({ setSignedCookie: vi.fn() }));
vi.mock("../../utils/segment", () => ({ identify: vi.fn() }));
vi.mock("../../utils/authSecret", () => ({ default: "secret" }));

vi.mock("../../utils/alchemy", () => ({
  headers: { "X-Alchemy-Token": "mock-token" },
}));

vi.mock("../../database", () => ({
  default: {
    insert: vi.fn().mockReturnValue({ values: vi.fn() }),
  },
  credentials: {},
}));

vi.mock("../../hooks/activity", () => ({
  get webhookId() {
    return mocks.webhookId.value;
  },
}));

vi.spyOn(globalThis, "fetch").mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(""),
} as Response);

let testRedis: Redis;

describe("createCredential - job queue", () => {
  const credentialId = "0x1234567890123456789012345678901234567890";

  beforeAll(() => {
    if (!process.env.REDIS_URL) throw new Error("missing REDIS_URL");
    testRedis = new Redis(process.env.REDIS_URL);
  });

  afterAll(async () => {
    await closeQueue();
    await closeRedis();
    await testRedis.quit();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.webhookId.value = "webhook-id";
    await testRedis.flushdb();
  });

  it("should process credential job through real queue when credential is created", async () => {
    await createCredential({} as Context, credentialId);

    await vi.waitFor(
      () => {
        expect(fetch).toHaveBeenCalledWith(
          "https://dashboard.alchemy.com/api/update-webhook-addresses",
          expect.objectContaining({
            method: "PATCH",
            headers: expect.objectContaining({ "X-Alchemy-Token": "mock-token" }) as Record<string, string>,
            body: expect.stringContaining("webhook-id") as string,
          }),
        );
      },
      { timeout: 5000, interval: 50 },
    );
  });

  it("should throw WebhookNotReadyError when webhookId is undefined", async () => {
    mocks.webhookId.value = undefined;

    await expect(createCredential({} as Context, credentialId)).rejects.toThrow(WebhookNotReadyError);
  });

  it("should capture exception when queue.add fails", async () => {
    const error = new Error("queue error");
    const spy = vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await createCredential({} as Context, credentialId);
    await vi.waitFor(
      () => {
        expect(vi.mocked(captureException)).toHaveBeenCalledWith(
          error,
          expect.objectContaining({
            level: "error",
            extra: expect.objectContaining({
              job: AccountJob.CREATE,
              webhookId: "webhook-id",
            }) as Record<string, unknown>,
          }),
        );
      },
      { timeout: 5000, interval: 50 },
    );

    spy.mockRestore();
  });
});

describe("credential queue processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call Alchemy API to update webhook addresses", async () => {
    const job = {
      name: AccountJob.CREATE,
      data: { account: "0x123", webhookId: "hook-123" },
    } as unknown as Job<AccountJobData>;

    await processor(job);

    expect(fetch).toHaveBeenCalledWith(
      "https://dashboard.alchemy.com/api/update-webhook-addresses",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "X-Alchemy-Token": "mock-token" }) as Record<string, string>,
        body: JSON.stringify({
          webhook_id: "hook-123",
          addresses_to_add: ["0x123"],
          addresses_to_remove: [],
        }),
      }),
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "credential.processor", op: "queue.process" }),
      expect.any(Function),
    );
  });

  it("should throw an error for unknown job names", async () => {
    const job = { name: "unknown", data: {} } as unknown as Job<AccountJobData>;
    await expect(processor(job)).rejects.toThrow("Unknown job name: unknown");
  });

  it("should throw an error if Alchemy API call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    } as Response);

    const job = {
      name: AccountJob.CREATE,
      data: { account: "0x123", webhookId: "hook-123" },
    } as unknown as Job<AccountJobData>;

    await expect(processor(job)).rejects.toThrow("500 Internal Server Error");
  });
});
