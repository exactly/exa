import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";
import path from "node:path";
import { createWalletClient, http, keccak256, nonceManager, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { expect, vi } from "vitest";

import type * as keeper from "../../utils/keeper";

// eslint-disable-next-line import/prefer-default-export
export let keeperClient: ReturnType<
  typeof createWalletClient<ReturnType<typeof http>, typeof chain, ReturnType<typeof privateKeyToAccount>>
>;

vi.mock("../../utils/keeper", async (importOriginal) => {
  if (!chain.rpcUrls.alchemy?.http[0]) throw new Error("missing alchemy rpc url");
  const original = await importOriginal<typeof keeper>();
  return {
    ...original,
    default: createWalletClient({
      chain,
      transport: http(chain.rpcUrls.alchemy.http[0], {
        fetchOptions: {
          headers: {
            Authorization: `Bearer ${alchemyAPIKey}`,
          },
        },
      }),
      account: privateKeyToAccount(
        keccak256(toBytes(path.relative(path.resolve(__dirname, ".."), expect.getState().testPath ?? ""))), // eslint-disable-line unicorn/prefer-module
        { nonceManager },
      ),
    }).extend((closureClient) => {
      keeperClient = closureClient;
      return original.extender(closureClient);
    }),
  };
});
