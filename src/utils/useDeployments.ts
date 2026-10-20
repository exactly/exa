import { useCallback } from "react";

import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import deployedOptions from "./deployedOptions";

import type { Address } from "viem";

export default function useDeployments(account: Address | undefined, chainIds: number[]) {
  return useQueries({
    queries: chainIds.map((chainId) => deployedOptions(account, chainId)),
    combine: useCallback(
      (results: UseQueryResult<boolean>[]) => {
        const pending = new Set<number>();
        const deployed = new Map<number, boolean>();
        for (const [index, chainId] of chainIds.entries()) {
          const result = results[index];
          if (!result) continue;
          if (result.isSuccess && typeof result.data === "boolean") deployed.set(chainId, result.data);
          else if (result.isLoading || result.isFetching) pending.add(chainId);
        }
        return { deployedChains: deployed, pendingChains: pending };
      },
      [chainIds],
    ),
  });
}
