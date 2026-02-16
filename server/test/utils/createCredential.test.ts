import "../mocks/sardine";
import "../mocks/sentry";

import { captureException, startSpan } from "@sentry/node";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import createCredential, { closeQueue, WebhookNotReadyError } from "../../utils/createCredential";
import { close as closeRedis } from "../../utils/redis";

import type { Context } from "hono";

const mocks = vi.hoisted(() => {
  let capturedProcessor: ((job: unknown) => Promise<unknown>) | undefined;
  const queue = { add: vi.fn().mockResolvedValue({}), close: vi.fn().mockResolvedValue(undefined) }; // eslint-disable-line unicorn/no-useless-undefined
  return {
    webhookId: { value: "webhook-id" as string | undefined },
    queue,
    captureProcessor(function_: (job: unknown) => Promise<unknown>) {
      capturedProcessor = function_;
    },
    get processor() {
      return capturedProcessor!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
    },
  };
});

vi.mock("bullmq", () => ({
  Queue: vi.fn(function (this: unknown) {
    return mocks.queue;
  }),
  Worker: vi.fn(function (this: unknown, _name: unknown, function_: (job: unknown) => Promise<unknown>) {
    mocks.captureProcessor(function_);
    return { on: vi.fn().mockReturnThis(), close: vi.fn().mockResolvedValue(undefined) }; // eslint-disable-line unicorn/no-useless-undefined
  }),
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

afterAll(async () => {
  await closeQueue();
  await closeRedis();
});

describe("createCredential - job queue", () => {
  const credentialId = "0x1234567890123456789012345678901234567890";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.webhookId.value = "webhook-id";
  });

  it("adds job to queue when credential is created", async () => {
    await createCredential({} as Context, credentialId);

    expect(mocks.queue.add).toHaveBeenCalledWith("create", {
      account: expect.any(String) as string,
      webhookId: "webhook-id",
    });
  });

  it("throws WebhookNotReadyError when webhookId is undefined", async () => {
    mocks.webhookId.value = undefined;

    await expect(createCredential({} as Context, credentialId)).rejects.toThrow(WebhookNotReadyError);
  });

  it("captures exception when queue.add fails", async () => {
    const error = new Error("queue error");
    mocks.queue.add.mockRejectedValueOnce(error);

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
  });
});

describe("credential queue processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Alchemy API to update webhook addresses", async () => {
    await mocks.processor({ name: "create", data: { account: "0x123", webhookId: "hook-123" } });

    expect(fetch).toHaveBeenCalledWith(
      "https://dashboard.alchemy.com/api/update-webhook-addresses",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ "X-Alchemy-Token": "mock-token" }) as Record<string, string>,
        body: JSON.stringify({ webhook_id: "hook-123", addresses_to_add: ["0x123"], addresses_to_remove: [] }),
      }),
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "credential.processor", op: "queue.process" }),
      expect.any(Function),
    );
  });

  it("throws for unknown job names", async () => {
    await expect(mocks.processor({ name: "unknown", data: {} })).rejects.toThrow("Unknown job name: unknown");
  });

  it("throws when Alchemy API call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    } as Response);

    await expect(
      mocks.processor({ name: "create", data: { account: "0x123", webhookId: "hook-123" } }),
    ).rejects.toThrow("500 Internal Server Error");
  });
});
