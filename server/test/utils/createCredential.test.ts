import "../mocks/sardine";
import "../mocks/sentry";

import { captureException, startSpan } from "@sentry/node";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import database, { credentials } from "../../database";
import createCredential, { closeQueue, queue, WebhookNotReadyError, worker } from "../../utils/createCredential";
import { close as closeRedis } from "../../utils/redis";

const mocks = vi.hoisted<{ webhookId: { value: string | undefined } }>(() => ({
  webhookId: { value: "webhook-id" },
}));

vi.mock("hono/cookie", () => ({ setSignedCookie: vi.fn() }));
vi.mock("../../utils/segment", () => ({ identify: vi.fn() }));
vi.mock("../../utils/authSecret", () => ({ default: "secret" }));
vi.mock("../../utils/alchemy", () => ({ headers: { "X-Alchemy-Token": "mock-token" } }));
vi.mock("../../hooks/activity", () => ({
  get webhookId() {
    return mocks.webhookId.value;
  },
}));

vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

const credentialId = "0x1234567890123456789012345678901234567888";

function credential() {
  return new Hono()
    .onError((error) => {
      throw error;
    })
    .post("/", async (c) => {
      await createCredential(c, credentialId);
      return c.body(null);
    })
    .request("/", { method: "POST" });
}

function jobDone(name: string, data: { account: string; webhookId: string }) {
  return new Promise<void>((resolve, reject) => {
    const completed = (job: { data: { account: string; webhookId: string }; name: string }) => {
      if (job.name !== name || job.data.account !== data.account || job.data.webhookId !== data.webhookId) return;
      cleanup();
      resolve();
    };
    const failed = (job: undefined | { data: { account: string; webhookId: string }; name: string }, error: Error) => {
      if (job?.name !== name || job.data.account !== data.account || job.data.webhookId !== data.webhookId) return;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off("completed", completed);
      worker.off("failed", failed);
    };
    worker.on("completed", completed);
    worker.on("failed", failed);
    queue.add(name, data, { attempts: 1 }).catch((error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error("queue add failed", { cause: error }));
    });
  });
}

describe("createCredential", () => {
  afterAll(async () => {
    await database.delete(credentials).where(eq(credentials.id, credentialId));
    await closeQueue();
    await closeRedis();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.webhookId.value = "webhook-id";
    await database.delete(credentials).where(eq(credentials.id, credentialId));
  });

  it("adds job to queue when credential is created", async () => {
    await credential();

    await vi.waitFor(() => {
      const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
      expect(init).toMatchObject({ method: "PATCH", headers: { "X-Alchemy-Token": "mock-token" } });
      expect(init?.body).toContain("webhook-id");
    });
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("throws WebhookNotReadyError when webhookId is undefined", async () => {
    mocks.webhookId.value = undefined;

    await expect(credential()).rejects.toThrow(WebhookNotReadyError);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("captures exception when queue.add fails", async () => {
    const error = new Error("queue error");
    const addSpy = vi.spyOn(queue, "add").mockRejectedValueOnce(error);

    await credential();
    await vi.waitFor(() => {
      expect(vi.mocked(captureException).mock.calls[0]?.[0]).toBe(error);
      expect(vi.mocked(captureException).mock.calls[0]?.[1]).toMatchObject({
        level: "error",
        extra: { job: "create", webhookId: "webhook-id" },
      });
    });
    expect(fetch).not.toHaveBeenCalled();
    addSpy.mockRestore();
  });

  it("calls Alchemy API to update webhook addresses", async () => {
    await jobDone("create", { account: "0x123", webhookId: "hook-123" });

    const [, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(init).toMatchObject({
      method: "PATCH",
      headers: { "X-Alchemy-Token": "mock-token" },
      body: JSON.stringify({ webhook_id: "hook-123", addresses_to_add: ["0x123"], addresses_to_remove: [] }),
    });
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "credential.processor", op: "queue.process" }),
      expect.any(Function),
    );
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("throws for unknown job names", async () => {
    await expect(jobDone("unknown", { account: "0x123", webhookId: "hook-123" })).rejects.toThrow(
      "Unknown job name: unknown",
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.mocked(captureException).mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(vi.mocked(captureException).mock.calls[0]?.[1]).toMatchObject({
      level: "error",
      extra: { job: { account: "0x123", webhookId: "hook-123" } },
    });
  });

  it("throws when Alchemy API call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Internal Server Error", { status: 500 }));

    await expect(jobDone("create", { account: "0x123", webhookId: "hook-123" })).rejects.toThrow(
      "500 Internal Server Error",
    );
    expect(vi.mocked(captureException).mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(vi.mocked(captureException).mock.calls[0]?.[1]).toMatchObject({
      level: "error",
      extra: { job: { account: "0x123", webhookId: "hook-123" } },
    });
  });
});
