import { vi } from "vitest";

import type alchemy from "../../utils/alchemy";

const { addWebhookAddresses, createAlchemy, createWebhook, findWebhook, headerValidator } = vi.hoisted(() => ({
  createAlchemy: vi.fn<(key: string) => void>(),
  findWebhook: vi.fn<ReturnType<typeof alchemy>["findWebhook"]>().mockResolvedValue(undefined), // eslint-disable-line unicorn/no-useless-undefined -- no hooks
  createWebhook: vi.fn<ReturnType<typeof alchemy>["createWebhook"]>(),
  addWebhookAddresses: vi.fn<ReturnType<typeof alchemy>["addWebhookAddresses"]>().mockResolvedValue(undefined), // eslint-disable-line unicorn/no-useless-undefined
  headerValidator: vi.fn<(signingKeys: Set<string>) => void>(),
}));

vi.mock(import("../../utils/alchemy"), async (importOriginal) => {
  const original = await importOriginal();
  createWebhook.mockImplementation(({ webhook_type, webhook_url }) =>
    Promise.resolve({
      id: "mock-webhook-id",
      is_active: true,
      network: original.network(),
      signing_key: "mock-signing-key",
      webhook_type,
      webhook_url,
    }),
  );
  return {
    ...original,
    default: (key: string) => {
      createAlchemy(key);
      return { ...original.default(key), findWebhook, createWebhook, addWebhookAddresses };
    },
    headerValidator: (
      signingKeys: Parameters<typeof original.headerValidator>[0],
    ): ReturnType<typeof original.headerValidator> => {
      headerValidator(typeof signingKeys === "function" ? signingKeys() : signingKeys);
      return vi.fn<ReturnType<typeof original.headerValidator>>(async (_c, next) => next());
    },
  };
});

export { addWebhookAddresses, createAlchemy, createWebhook, findWebhook, headerValidator };
