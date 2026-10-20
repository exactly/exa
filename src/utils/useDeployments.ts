import { useCallback } from "react";

import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";

import deployedOptions from "./deployedOptions";

import type { Credential } from "@exactly/common/validation";
import type { Address } from "viem";

export default function useDeployments(account: Address | undefined, chainIds: number[]) {
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { deployedChains, pendingChains } = useQueries({
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
  return useQueries({
    queries: chainIds.map((chainId) =>
      deployedOptions(deployedChains.get(chainId) === false ? credential?.factory : undefined, chainId),
    ),
    combine: useCallback(
      (results: UseQueryResult<boolean>[]) => {
        const pending = new Set(pendingChains);
        const deployable = new Set<number>();
        for (const [index, chainId] of chainIds.entries()) {
          if (results[index]?.data === true) deployable.add(chainId);
          else if (results[index]?.isLoading) pending.add(chainId);
        }
        return { deployedChains, pendingChains: pending, deployableChains: deployable };
      },
      [chainIds, deployedChains, pendingChains],
    ),
  });
}
