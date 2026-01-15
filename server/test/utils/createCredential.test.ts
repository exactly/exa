import { captureException } from "@sentry/node";
import type { Context } from "hono";
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";

import { alchemyQueue } from "../../queues/alchemyQueue";
import { AlchemyJob } from "../../queues/constants";
import createCredential from "../../utils/createCredential";

// Mock dependencies
vi.mock("../../queues/alchemyQueue", () => ({
  alchemyQueue: {
    add: vi.fn<(name: string, data: unknown) => Promise<unknown>>().mockResolvedValue({}),
  },
}));

vi.mock("../../database", () => ({
  default: {
    insert: vi.fn<() => unknown>().mockReturnValue({ values: vi.fn<() => unknown>() }),
  },
  credentials: {},
}));

vi.mock("hono/cookie", () => ({
  setSignedCookie: vi.fn<(c: Context, name: string, value: string) => Promise<void>>(),
}));

vi.mock("@sentry/core", () => ({
  setUser: vi.fn<(user: unknown) => void>(),
}));

vi.mock("@sentry/node", { spy: true });

vi.mock("../../utils/segment", () => ({
  identify: vi.fn<(userId: string) => void>(),
}));

vi.mock("../../utils/authSecret", () => ({
  default: "secret",
}));

const mocks = vi.hoisted(() => ({
  webhookId: { value: "webhook-id" as string | undefined },
}));

vi.mock("../../hooks/activity", () => ({
  get webhookId() {
    return mocks.webhookId.value;
  },
}));

vi.mock("../../utils/sardine", () => ({
  customer: vi.fn().mockResolvedValue({}),
}));

// Mock global fetch to avoid actual network calls
vi.spyOn(global, "fetch").mockResolvedValue({
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

    expect((alchemyQueue as unknown as { add: Mock }).add).toHaveBeenCalledWith(
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
    vi.spyOn(alchemyQueue, "add").mockRejectedValueOnce(error);

    await createCredential(mockContext, credentialId);

    expect(vi.mocked(captureException)).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({
          job: AlchemyJob.ADD_SUBSCRIBER,
          webhookId: "webhook-id",
        }),
      }),
    );
  });

  it("should not add job to alchemyQueue if webhookId is undefined", async () => {
    const credentialId = "0x1234567890123456789012345678901234567890";
    mocks.webhookId.value = undefined;

    await createCredential(mockContext, credentialId);

    expect((alchemyQueue as unknown as { add: Mock }).add).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });
});
