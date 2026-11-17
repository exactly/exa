import { arbitrum, bsc, mainnet, optimism } from "@account-kit/infra";
import { vi } from "vitest";

import type alchemy from "../../utils/alchemy";

const {
  addWebhookAddresses,
  createAlchemy,
  createWebhook,
  findWebhook,
  getWebhookAddresses,
  getWebhooks,
  headerValidator,
  setWebhookActive,
} = vi.hoisted(() => ({
  addWebhookAddresses: vi.fn<ReturnType<typeof alchemy>["addWebhookAddresses"]>().mockResolvedValue(),
  createAlchemy: vi.fn<(key: string) => void>(),
  findWebhook: vi.fn<ReturnType<typeof alchemy>["findWebhook"]>().mockResolvedValue(undefined), // eslint-disable-line unicorn/no-useless-undefined -- no hooks
  createWebhook: vi.fn<ReturnType<typeof alchemy>["createWebhook"]>(),
  getWebhookAddresses: vi.fn<ReturnType<typeof alchemy>["getWebhookAddresses"]>().mockResolvedValue({
    data: [],
    pagination: { cursors: {}, total_count: 0 },
  }),
  getWebhooks: vi.fn<ReturnType<typeof alchemy>["getWebhooks"]>().mockResolvedValue([]),
  headerValidator: vi.fn<(signingKeys: Set<string>) => void>(),
  setWebhookActive: vi.fn<ReturnType<typeof alchemy>["setWebhookActive"]>().mockResolvedValue(),
}));

vi.mock(import("../../utils/alchemy"), async (importOriginal) => {
  const original = await importOriginal();
  getWebhooks.mockResolvedValue(
    ["ANVIL", "ANVIL2", "BNB_MAINNET", "ETH_MAINNET", "OPT_MAINNET"].map((network) => ({
      id: network === "ANVIL" ? "activity" : network,
      is_active: true,
      network,
      signing_key: "activity",
      webhook_type: "ADDRESS_ACTIVITY",
      webhook_url: original.activityUrl,
    })),
  );
  createWebhook.mockImplementation(({ network, webhook_type, webhook_url }) =>
    Promise.resolve({
      id: "mock-webhook-id",
      is_active: true,
      network: network ?? original.network(),
      signing_key: "mock-signing-key",
      webhook_type,
      webhook_url,
    }),
  );
  return {
    ...original,
    NETWORKS: new Map([
      ...original.NETWORKS,
      ...Object.entries({ ARB_MAINNET: arbitrum, BNB_MAINNET: bsc, ETH_MAINNET: mainnet, OPT_MAINNET: optimism }).map(
        ([name, chain]) => [name, chain as NonNullable<ReturnType<typeof original.NETWORKS.get>>] as const,
      ),
    ]),
    default: (key: string) => {
      createAlchemy(key);
      return {
        ...original.default(key),
        addWebhookAddresses,
        createWebhook,
        findWebhook,
        getWebhookAddresses,
        getWebhooks,
        setWebhookActive,
      };
    },
    headerValidator: (
      signingKeys: Parameters<typeof original.headerValidator>[0],
    ): ReturnType<typeof original.headerValidator> => {
      headerValidator(typeof signingKeys === "function" ? signingKeys() : signingKeys);
      return vi.fn<ReturnType<typeof original.headerValidator>>(async (_c, next) => next());
    },
  };
});

export {
  addWebhookAddresses,
  createAlchemy,
  createWebhook,
  findWebhook,
  getWebhookAddresses,
  getWebhooks,
  headerValidator,
  setWebhookActive,
};
