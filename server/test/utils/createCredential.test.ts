import "../mocks/redis";

import { captureException } from "@sentry/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlchemyJob } from "../../queues/alchemyQueue";
import createCredential, { WebhookNotReadyError } from "../../utils/createCredential";

import type * as AlchemyQueue from "../../queues/alchemyQueue";
import type { Context } from "hono";

const mocks = vi.hoisted(() => ({
  webhookId: { value: "webhook-id" as string | undefined },
  addJob: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../queues/alchemyQueue", async (importOriginal) => {
  const actual = await importOriginal<typeof AlchemyQueue>();
  return { ...actual, getAlchemyQueue: vi.fn(() => ({ add: mocks.addJob })) };
});

vi.mock("../../database", () => ({
  default: {
    insert: vi.fn().mockReturnValue({ values: vi.fn() }),
  },
  credentials: {},
}));

vi.mock("hono/cookie", () => ({
  setSignedCookie: vi.fn(),
}));

vi.mock("@sentry/core", () => ({
  setUser: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@sentry/node", { spy: true });

vi.mock("../../utils/segment", () => ({
  identify: vi.fn(),
}));

vi.mock("../../utils/authSecret", () => ({
  default: "secret",
}));

vi.mock("../../hooks/activity", () => ({
  get webhookId() {
    return mocks.webhookId.value;
  },
}));

vi.mock("../../utils/sardine", () => ({
  customer: vi.fn().mockResolvedValue({}),
}));

vi.spyOn(globalThis, "fetch").mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(""),
} as Response);

describe("createCredential - job queue", () => {
  const mockContext = { req: {}, json: vi.fn<(data: unknown) => Response>() } as unknown as Context;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.webhookId.value = "webhook-id";
  });

  it("should add a job to alchemyQueue when credential is created", async () => {
    const credentialId = "0x1234567890123456789012345678901234567890";

    await createCredential(mockContext, credentialId);

    expect(mocks.addJob).toHaveBeenCalledWith(
      AlchemyJob.ADD_SUBSCRIBER,
      expect.objectContaining({
        account: expect.stringMatching(/^0x/) as string,
        webhookId: "webhook-id",
      }),
    );
  });

  it("should capture exception when alchemyQueue.add fails", async () => {
    const credentialId = "0x1234567890123456789012345678901234567890";
    const error = new Error("queue error");
    mocks.addJob.mockRejectedValueOnce(error);

    await createCredential(mockContext, credentialId);

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({
          job: AlchemyJob.ADD_SUBSCRIBER,
          webhookId: "webhook-id",
        }) as Record<string, unknown>,
      }),
    );
  });

  it("should throw WebhookNotReadyError if webhookId is undefined", async () => {
    const credentialId = "0x1234567890123456789012345678901234567890";
    mocks.webhookId.value = undefined;

    await expect(createCredential(mockContext, credentialId)).rejects.toThrow(WebhookNotReadyError);

    expect(mocks.addJob).not.toHaveBeenCalled();
  });
});
