import { useQuery } from "@tanstack/react-query";

import accountInit from "@exactly/common/accountInit";
import chain, { exaPluginAddress, proposalManagerAddress } from "@exactly/common/generated/chain";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "@exactly/common/generated/hooks";

import queryClient from "./queryClient";
import useAccount from "./useAccount";
import useInstalledProposalManager, { installedProposalManagerOptions } from "./useInstalledProposalManager";

import type { Credential } from "@exactly/common/validation";

export default function useProposalManager() {
  return useProposalManagerQuery().proposalManager;
}

export function useProposalManagerQuery() {
  const { address } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const {
    data: installedPlugins,
    error: pluginsError,
    errorUpdateCount: pluginsErrorUpdateCount,
    isLoading: isPluginsLoading,
    refetch: refetchPlugins,
  } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    chainId: chain.id,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: {
      enabled: !!address && !!credential,
      staleTime: Infinity,
      refetchInterval: ({ state }) => (state.error ? 20_000 : false),
    },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  const { proposalManager, error, failed, isLoading } = useInstalledProposalManager(
    installedPlugins?.[0],
    !isLatestPlugin,
  );
  return {
    proposalManager: isLatestPlugin ? proposalManagerAddress : proposalManager,
    error: installedPlugins === undefined ? pluginsError : isLatestPlugin ? null : error,
    failed: installedPlugins === undefined ? pluginsErrorUpdateCount > 0 : !isLatestPlugin && failed,
    isLoading: isPluginsLoading || isLoading,
    refetch: async () => {
      let plugin = installedPlugins?.[0];
      if (plugin === undefined) {
        const { data } = await refetchPlugins();
        plugin = data?.[0];
      }
      if (plugin === undefined) return;
      if (plugin === exaPluginAddress) return proposalManagerAddress;
      return queryClient.fetchQuery(installedProposalManagerOptions(plugin)).catch(() => undefined);
    },
  };
}
