import { queryOptions, useQuery } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";
import { BaseError, ExecutionRevertedError, type Address } from "viem";

import accountInit from "@exactly/common/accountInit";
import { exaPluginAbi, useReadUpgradeableModularAccountGetInstalledPlugins } from "@exactly/common/generated/hooks";

import queryClient from "./queryClient";
import useAccount from "./useAccount";
import exa from "./wagmi/exa";

import type { Credential } from "@exactly/common/validation";

export default function useProposalManager(chainId: number) {
  return useProposalManagerQuery(chainId).proposalManager;
}

export function useProposalManagerQuery(chainId: number) {
  const { address } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const plugins = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    chainId,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: {
      enabled: !!address && !!credential,
      staleTime: Infinity,
      refetchInterval: ({ state }) => (state.error ? 20_000 : false),
    },
  });
  const installed = useQuery({
    ...installedProposalManagerOptions(plugins.data?.[0], chainId),
    enabled: !!plugins.data?.[0],
    refetchInterval: ({ state }) => (state.error ? 20_000 : false),
  });
  return {
    proposalManager: installed.data,
    error: plugins.data === undefined ? plugins.error : installed.data === undefined ? installed.error : null,
    failed:
      plugins.data === undefined
        ? plugins.errorUpdateCount > 0
        : installed.data === undefined && installed.errorUpdateCount > 0,
    isLoading: plugins.isLoading || installed.isLoading,
    refetch: async () => {
      let plugin = plugins.data?.[0];
      if (plugin === undefined) {
        const { data } = await plugins.refetch();
        plugin = data?.[0];
      }
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
