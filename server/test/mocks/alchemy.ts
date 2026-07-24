import { validator } from "hono/validator";
import { vi } from "vitest";

import type * as Alchemy from "../../utils/alchemy";

const { addWebhookAddresses, createAlchemy, createWebhook, findWebhook, headerValidator } = vi.hoisted(() => ({
  createAlchemy: vi.fn(),
  findWebhook: vi.fn().mockResolvedValue({ id: "activity", signing_key: "mock-signing-key" }),
  createWebhook: vi.fn().mockResolvedValue({ id: "mock-webhook-id", signing_key: "mock-signing-key" }),
  addWebhookAddresses: vi.fn().mockResolvedValue(undefined), // eslint-disable-line unicorn/no-useless-undefined
  headerValidator: vi.fn(),
}));

vi.mock("../../utils/alchemy", async (importOriginal) => {
  const alchemy = await importOriginal<typeof Alchemy>();
  return {
    ...alchemy,
    default: (key: string) => {
      createAlchemy(key);
      return { ...alchemy.default(key), findWebhook, createWebhook, addWebhookAddresses };
    },
    headerValidator: (signingKeys: Set<string>) => {
      headerValidator(signingKeys);
      return validator("header", () => undefined);
    },
  };
});

export { addWebhookAddresses, createAlchemy, createWebhook, findWebhook, headerValidator };
