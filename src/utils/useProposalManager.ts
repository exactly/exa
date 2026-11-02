import { useQuery } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";

import accountInit from "@exactly/common/accountInit";
import chain from "@exactly/common/generated/chain";
import { exaPluginAbi, useReadUpgradeableModularAccountGetInstalledPlugins } from "@exactly/common/generated/hooks";

import useAccount from "./useAccount";

import type { Credential } from "@exactly/common/validation";

export default function useProposalManager() {
  const { address } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    chainId: chain.id,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: { enabled: !!address && !!credential, staleTime: Infinity },
  });
  const { data: [proposalManager] = [] } = useReadContracts({
    contracts: [
      { address: installedPlugins?.[0], abi: exaPluginAbi, functionName: "proposalManager", chainId: chain.id },
    ] as const,
    query: { enabled: !!installedPlugins?.[0], staleTime: Infinity },
  });
  return proposalManager && (proposalManager.result ?? null);
}
