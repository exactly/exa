import { queryOptions, skipToken } from "@tanstack/react-query";
import { getBytecode } from "@wagmi/core/actions";

import exaConfig from "./wagmi/exa";

import type { Address } from "viem";

export default function deployedOptions(address: Address | undefined, chainId: number | undefined) {
  return queryOptions({
    queryKey: ["deployed", address, chainId],
    queryFn:
      address !== undefined && chainId !== undefined
        ? async () => !!(await getBytecode(exaConfig, { address, chainId }))
        : skipToken,
    staleTime: (query) => (query.state.data === undefined ? 0 : Infinity),
    gcTime: Infinity,
  });
}
