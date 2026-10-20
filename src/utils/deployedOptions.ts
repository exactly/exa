import { queryOptions, skipToken } from "@tanstack/react-query";
import { getBytecode } from "@wagmi/core/actions";

import chain from "@exactly/common/generated/chain";

import alchemyChainById from "./alchemyChains";
import { newMessage } from "./intercom";
import queryClient from "./queryClient";
import exaConfig from "./wagmi/exa";

import type { TFunction } from "i18next";
import type { Address } from "viem";

export default function deployedOptions(address: Address | undefined, chainId: number | undefined) {
  return queryOptions({
    queryKey: ["deployed", address, chainId],
    queryFn:
      address !== undefined && chainId !== undefined
        ? async () => !!(await getBytecode(exaConfig, { address, chainId }))
        : skipToken,
    staleTime: (query) => (query.state.data ? Infinity : 0),
    gcTime: Infinity,
  });
}

export function isUnsupported(chainId: number, deployedChains: Map<number, boolean>) {
  return chainId !== chain.id && (!alchemyChainById.has(chainId) || deployedChains.get(chainId) === false);
}

export function revalidateUnsupported() {
  return queryClient.invalidateQueries({ queryKey: ["deployed"], predicate: (query) => query.state.data === false });
}

export function requestDeployment(t: TFunction, account: Address, chainId: number) {
  return newMessage(
    t(
      "Hi! My account isn't set up on {{network}} yet, so I can't use my funds there.\n\nNetwork: {{network}} (chain ID {{chainId}})\nAccount: {{account}}",
      { network: alchemyChainById.get(chainId)?.name ?? chainId, chainId, account },
    ),
  );
}
