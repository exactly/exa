import { queryOptions, skipToken } from "@tanstack/react-query";
import { getBytecode } from "@wagmi/core/actions";

import chain from "@exactly/common/generated/chain";

import alchemyChainById from "./alchemyChains";
import queryClient from "./queryClient";
import exaConfig from "./wagmi/exa";

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
