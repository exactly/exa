import "./traceClient";

import path from "node:path";
import {
  createWalletClient,
  http,
  keccak256,
  publicActions,
  toBytes,
  type Chain,
  type LocalAccount,
  type NonceManagerSource,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getTransactionCount } from "viem/actions";
import { expect, vi } from "vitest";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";

import publicClient from "../../utils/publicClient";

import type * as nonceManager from "../../utils/nonceManager";
import type * as wallet from "../../utils/wallet";

export let walletClient: Parameters<typeof wallet.extender>[0];

vi.mock("../../utils/wallet", async (importOriginal) => {
  const original = await importOriginal<typeof wallet>();
  const account = privateKeyToAccount(
    keccak256(toBytes(path.relative(path.resolve(__dirname, ".."), expect.getState().testPath ?? ""))), // eslint-disable-line unicorn/prefer-module
    { nonceManager: await import("../../utils/nonceManager").then(({ default: manager }) => manager) },
  );
  const create = (network: Chain = chain) => {
    const url = network.rpcUrls.alchemy?.http[0];
    if (!url) throw new Error("missing alchemy rpc url");
    return createWalletClient({ chain: network, transport: http(`${url}/${alchemyAPIKey}`), account })
      .extend(publicActions)
      .extend((wallet) => {
        walletClient = wallet;
        return original.extender(wallet, { publicClient });
      });
  };
  const keeper = create();
  return {
    ...original,
    default: vi.fn((_account: LocalAccount, network?: Chain) => (network ? create(network) : keeper)),
    signer: vi.fn(() => Promise.resolve(account)),
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
