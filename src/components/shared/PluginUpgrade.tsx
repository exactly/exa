import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain, { exaPluginAddress } from "@exactly/common/generated/chain";
import {
  exaPluginAbi,
  upgradeableModularAccountAbi,
  useReadExaPluginPluginManifest,
  useReadUpgradeableModularAccountGetInstalledPlugins,
  useSimulateUpgradeableModularAccountUninstallPlugin,
} from "@exactly/common/generated/hooks";
import { useMutation } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import React from "react";
import { encodeAbiParameters, getAbiItem, keccak256, zeroAddress } from "viem";
import { useBytecode, useSendCalls } from "wagmi";

import InfoAlert from "./InfoAlert";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import exa from "../../utils/wagmi/exa";

export default function PluginUpgrade() {
  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins, refetch: refetchInstalledPlugins } =
    useReadUpgradeableModularAccountGetInstalledPlugins({
      address,
      query: { refetchOnMount: true, enabled: !!address && !!bytecode },
    });
  const { data: pluginManifest } = useReadExaPluginPluginManifest({ address: exaPluginAddress });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  const { data: uninstallPluginSimulation } = useSimulateUpgradeableModularAccountUninstallPlugin({
    address,
    args: [installedPlugins?.[0] ?? zeroAddress, "0x", "0x"],
    query: { enabled: !!address && !!installedPlugins && !!bytecode && !isLatestPlugin },
  });
  const isReady =
    !!bytecode && !!installedPlugins && !!pluginManifest && !!uninstallPluginSimulation && !isLatestPlugin;
  const { mutateAsync: updatePlugin, isPending: isUpdating } = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("no account address");
      if (!installedPlugins?.[0]) throw new Error("no installed plugin");
      if (!uninstallPluginSimulation) throw new Error("no uninstall plugin simulation");
      if (!pluginManifest) throw new Error("invalid manifest");

      const { id } = await mutateSendCalls({
        calls: [
          { to: address, ...uninstallPluginSimulation.request },
          {
            to: address,
            abi: upgradeableModularAccountAbi,
            functionName: "installPlugin",
            args: [
              exaPluginAddress,
              keccak256(
                encodeAbiParameters(getAbiItem({ abi: exaPluginAbi, name: "pluginManifest" }).outputs, [
                  pluginManifest,
                ]),
              ),
              "0x",
              [],
            ],
          },
        ],
        capabilities: {
          paymasterService: {
            url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
            context: { policyId: alchemyGasPolicyId },
          },
        },
      });
      const { status, receipts } = await waitForCallsStatus(exa, { id });
      if (status === "failure") throw new Error("failed to upgrade plugin");
      return receipts;
    },
    onSuccess: async () => {
      await refetchInstalledPlugins();
    },
  });

  if (!isReady) return null;

  return (
    <InfoAlert
      title="An account upgrade is required to access the latest features."
      actionText="Upgrade account now"
      loading={isUpdating}
      onPress={() => {
        updatePlugin().catch(reportError);
      }}
    />
  );
}
