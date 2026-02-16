import { validator } from "hono/validator";
import { vi } from "vitest";

const { findWebhook, createWebhook } = vi.hoisted(() => ({
  findWebhook: vi.fn().mockResolvedValue({}),
  createWebhook: vi.fn().mockResolvedValue({ id: "mock-webhook-id", signing_key: "mock-signing-key" }),
}));

vi.mock("../../utils/alchemy", async (importOriginal) => ({
  ...(await importOriginal()),
  headerValidator: () => validator("header", () => undefined),
  findWebhook,
  createWebhook,
}));

export { createWebhook, findWebhook };
