import { validator } from "hono/validator";
import { vi } from "vitest";

vi.mock("../../utils/alchemy", async (importOriginal) => ({
  ...(await importOriginal()),
  headerValidator: () => validator("header", () => undefined),
  findWebhook: () => Promise.resolve(),
  createWebhook: () => Promise.resolve({ id: "mock-webhook-id", signing_key: "mock-signing-key" }),
  updateWebhookAddresses: () => Promise.resolve(),
}));
