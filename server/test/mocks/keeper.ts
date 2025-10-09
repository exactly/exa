import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";
import path from "node:path";
import { createWalletClient, http, keccak256, toBytes, type NonceManagerSource } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getTransactionCount } from "viem/actions";
import { expect, vi } from "vitest";

import type * as keeper from "../../utils/keeper";
import type * as nonceManager from "../../utils/nonceManager";

export let keeperClient: ReturnType<
  typeof createWalletClient<ReturnType<typeof http>, typeof chain, ReturnType<typeof privateKeyToAccount>>
>;

vi.mock("../../utils/keeper", async (importOriginal) => {
  const original = await importOriginal<typeof keeper>();
  return {
    ...original,
    default: createWalletClient({
      chain,
      transport: http(`${chain.rpcUrls.alchemy?.http[0]}/${alchemyAPIKey}`),
      account: privateKeyToAccount(
        keccak256(toBytes(path.relative(path.resolve(__dirname, ".."), expect.getState().testPath ?? ""))), // eslint-disable-line unicorn/prefer-module
        { nonceManager: original.default.account.nonceManager },
      ),
    }).extend((closureClient) => {
      keeperClient = closureClient;
      return original.extender(closureClient);
    }),
  };
});

export const nonceSource: NonceManagerSource = {
  get: ({ address, client }) => getTransactionCount(client, { address, blockTag: "pending" }),
  set: () => undefined,
};

vi.mock("../../utils/nonceManager", async (importOriginal) => {
  const original = await importOriginal<typeof nonceManager>();
  return { ...original, default: original.createNonceManager({ source: nonceSource }) };
});
