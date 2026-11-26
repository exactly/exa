import { queryOptions, useQuery } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";
import { BaseError, ExecutionRevertedError, type Address } from "viem";

import { exaPluginAbi } from "@exactly/common/generated/hooks";

import queryClient from "./queryClient";
import useExaPlugin from "./useExaPlugin";
import exa from "./wagmi/exa";

export default function useProposalManager(chainId: number) {
  return useProposalManagerQuery(chainId).proposalManager;
}

export function useProposalManagerQuery(chainId: number) {
  const { plugin, failed } = useExaPlugin(chainId, Infinity);
  const installed = useQuery({
    ...installedProposalManagerOptions(plugin, chainId),
    enabled: !!plugin,
    refetchInterval: ({ state }) => (state.error ? 20_000 : false),
  });
  return {
    proposalManager: installed.data,
    error: installed.data === undefined ? installed.error : null,
    failed: plugin === undefined ? failed : installed.data === undefined && installed.errorUpdateCount > 0,
    refetch: async () => {
      if (plugin === undefined) return;
      return queryClient.fetchQuery(installedProposalManagerOptions(plugin, chainId)).catch(() => undefined);
    },
  };
}

function installedProposalManagerOptions(plugin: Address | undefined, chainId: number) {
  return queryOptions({
    queryKey: ["plugin", "proposalManager", chainId, plugin],
    queryFn: async () => {
      if (!plugin) throw new Error("no plugin");
      try {
        return await readContract(exa, {
          address: plugin,
          abi: exaPluginAbi,
          functionName: "proposalManager",
          chainId,
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
