import "../mocks/redis";
import "../mocks/sentry";

import { startSpan } from "@sentry/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlchemyJob, processor, type AlchemyJobData } from "../../queues/alchemyQueue";

import type { Job } from "bullmq";

vi.mock("../../utils/alchemy", () => ({
  headers: { "X-Alchemy-Token": "mock-token" },
}));

vi.spyOn(globalThis, "fetch").mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({}),
  text: () => Promise.resolve(""),
} as Response);

describe("alchemyQueue worker processor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call Alchemy API to update webhook addresses", async () => {
    const job = {
      name: AlchemyJob.ADD_SUBSCRIBER,
      data: {
        account: "0x123",
        webhookId: "hook-123",
      },
    } as unknown as Job<AlchemyJobData>;

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
      expect.objectContaining({ name: "alchemy.processor", op: "queue.process" }),
      expect.any(Function),
    );
  });

  it("should throw an error for unknown job names", async () => {
    const job = { name: "unknown", data: {} } as unknown as Job<AlchemyJobData>;
    await expect(processor(job)).rejects.toThrow("Unknown job name: unknown");
  });

  it("should throw an error if Alchemy API call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    } as Response);

    const job = {
      name: AlchemyJob.ADD_SUBSCRIBER,
      data: {
        account: "0x123",
        webhookId: "hook-123",
      },
    } as unknown as Job<AlchemyJobData>;

    await expect(processor(job)).rejects.toThrow("500 Internal Server Error");
  });
});
