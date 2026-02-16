import "../mocks/sardine";
import "../mocks/sentry";

import { captureException, startSpan } from "@sentry/node";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import database, { credentials } from "../../database";
import createCredential, { closeQueue, queue, WebhookNotReadyError, worker } from "../../utils/createCredential";
import { close as closeRedis } from "../../utils/redis";

import type { Context } from "hono";

const mocks = vi.hoisted(() => ({
  webhookId: { value: "webhook-id" as string | undefined },
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

vi.spyOn(globalThis, "fetch").mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(""),
} as Response);

const credentialId = "0x1234567890123456789012345678901234567890";

function jobDone(name: string, data: { account: string; webhookId: string }) {
  return new Promise<void>((resolve, reject) => {
    worker.once("completed", () => resolve());
    worker.once("failed", (_: unknown, error: Error) => {
      reject(error);
    });
    queue.add(name, data, { attempts: 1 }).catch(reject);
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
    await createCredential({} as Context, credentialId);

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "https://dashboard.alchemy.com/api/update-webhook-addresses",
        expect.objectContaining({
          method: "PATCH",
          headers: expect.objectContaining({ "X-Alchemy-Token": "mock-token" }) as Record<string, string>,
          body: expect.stringContaining("webhook-id") as string,
        }),
      );
    });
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("throws WebhookNotReadyError when webhookId is undefined", async () => {
    mocks.webhookId.value = undefined;

    await expect(createCredential({} as Context, credentialId)).rejects.toThrow(WebhookNotReadyError);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("captures exception when queue.add fails", async () => {
    const error = new Error("queue error");
    const addSpy = vi.spyOn(queue, "add").mockRejectedValueOnce(error);

    await createCredential({} as Context, credentialId);
    await vi.waitFor(() => {
      expect(vi.mocked(captureException)).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          level: "error",
          extra: expect.objectContaining({ job: "create", webhookId: "webhook-id" }) as Record<string, unknown>,
        }),
      );
    });
    expect(fetch).not.toHaveBeenCalled();
    addSpy.mockRestore();
  });

  it("calls Alchemy API to update webhook addresses", async () => {
    await jobDone("create", { account: "0x123", webhookId: "hook-123" });

    expect(fetch).toHaveBeenCalledWith(
      "https://dashboard.alchemy.com/api/update-webhook-addresses",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "X-Alchemy-Token": "mock-token" }) as Record<string, string>,
        body: JSON.stringify({ webhook_id: "hook-123", addresses_to_add: ["0x123"], addresses_to_remove: [] }),
      }),
    );
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
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ level: "error", extra: { job: { account: "0x123", webhookId: "hook-123" } } }),
    );
  });

  it("throws when Alchemy API call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    } as Response);

    await expect(jobDone("create", { account: "0x123", webhookId: "hook-123" })).rejects.toThrow(
      "500 Internal Server Error",
    );
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ level: "error", extra: { job: { account: "0x123", webhookId: "hook-123" } } }),
    );
  });
});
