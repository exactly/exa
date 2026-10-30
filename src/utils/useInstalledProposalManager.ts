import { queryOptions, useQuery } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";
import { BaseError, ExecutionRevertedError, type Address } from "viem";

import chain from "@exactly/common/generated/chain";
import { exaPluginAbi } from "@exactly/common/generated/hooks";

import exa from "./wagmi/exa";

export default function useInstalledProposalManager(plugin: Address | undefined, enabled = true) {
  const query = useQuery({
    ...installedProposalManagerOptions(plugin),
    enabled: enabled && !!plugin,
    refetchInterval: ({ state }) => (state.error ? 20_000 : false),
  });
  return {
    proposalManager: query.data,
    error: query.data === undefined ? query.error : null,
    failed: query.data === undefined && query.errorUpdateCount > 0,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

export function installedProposalManagerOptions(plugin: Address | undefined) {
  return queryOptions({
    queryKey: ["plugin", "proposalManager", chain.id, plugin],
    queryFn: async () => {
      if (!plugin) throw new Error("no plugin");
      try {
        return await readContract(exa, {
          address: plugin,
          abi: exaPluginAbi,
          functionName: "proposalManager",
          chainId: chain.id,
        });
      } catch (error: unknown) {
        if (error instanceof BaseError && error.walk((cause) => cause instanceof ExecutionRevertedError) !== null) {
          return null;
        }
        throw error;
      }
    },
  });
}
