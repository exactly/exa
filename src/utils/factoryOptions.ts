import { queryOptions, skipToken } from "@tanstack/react-query";
import { getBytecode } from "@wagmi/core/actions";

import exaConfig from "./wagmi/exa";

import type { Address } from "viem";

export default function factoryOptions(factory: Address | undefined, chainId: number | undefined) {
  return queryOptions({
    queryKey: ["factory", factory, chainId],
    queryFn:
      factory !== undefined && chainId !== undefined
        ? async () => !!(await getBytecode(exaConfig, { address: factory, chainId }))
        : skipToken,
    staleTime: (query) => (query.state.data ? Infinity : 24 * 60 * 60 * 1000),
    gcTime: Infinity,
    retry: false,
  });
}
