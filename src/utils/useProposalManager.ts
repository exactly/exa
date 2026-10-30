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
  const plugins = useReadUpgradeableModularAccountGetInstalledPlugins({
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
  const isLatestPlugin = plugins.data?.[0] === exaPluginAddress;
  const installed = useInstalledProposalManager(plugins.data?.[0], !isLatestPlugin);
  return {
    proposalManager: isLatestPlugin ? proposalManagerAddress : installed.proposalManager,
    error: plugins.data === undefined ? plugins.error : isLatestPlugin ? null : installed.error,
    failed: plugins.data === undefined ? plugins.errorUpdateCount > 0 : !isLatestPlugin && installed.failed,
    isLoading: plugins.isLoading || installed.isLoading,
    refetch: async () => {
      let plugin = plugins.data?.[0];
      if (plugin === undefined) {
        const { data } = await plugins.refetch();
        plugin = data?.[0];
      }
      if (plugin === undefined) return;
      if (plugin === exaPluginAddress) return proposalManagerAddress;
      return queryClient.fetchQuery(installedProposalManagerOptions(plugin)).catch(() => undefined);
    },
  };
}
