import { validator } from "hono/validator";
import { vi } from "vitest";

const { addWebhookAddresses, createWebhook, findWebhook, headerValidator } = vi.hoisted(() => ({
  findWebhook: vi.fn().mockResolvedValue({ id: "activity", signing_key: "mock-signing-key" }),
  createWebhook: vi.fn().mockResolvedValue({ id: "mock-webhook-id", signing_key: "mock-signing-key" }),
  addWebhookAddresses: vi.fn().mockResolvedValue(undefined), // eslint-disable-line unicorn/no-useless-undefined
  headerValidator: vi.fn(),
}));

vi.mock("../../utils/alchemy", async (importOriginal) => ({
  ...(await importOriginal()),
  headerValidator: (signingKeys: Set<string>) => {
    headerValidator(signingKeys);
    return validator("header", () => undefined);
  },
  findWebhook,
  createWebhook,
  addWebhookAddresses,
}));

export { addWebhookAddresses, createWebhook, findWebhook, headerValidator };
