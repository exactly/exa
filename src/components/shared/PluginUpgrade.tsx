import React from "react";
import { useTranslation } from "react-i18next";

import { useMutation } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import { encodeAbiParameters, getAbiItem, keccak256, zeroAddress } from "viem";
import { useBytecode, useChainId, useSendCalls } from "wagmi";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain from "@exactly/common/generated/chain";
import {
  exaPluginAbi,
  exaPluginAddress,
  upgradeableModularAccountAbi,
  useReadExaPluginPluginManifest,
  useReadUpgradeableModularAccountGetInstalledPlugins,
  useSimulateUpgradeableModularAccountUninstallPlugin,
} from "@exactly/common/generated/hooks";

import InfoAlert from "./InfoAlert";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import exa from "../../utils/wagmi/exa";

export default function PluginUpgrade() {
  const { t } = useTranslation();
  const chainId = useChainId();
  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins, refetch: refetchInstalledPlugins } =
    useReadUpgradeableModularAccountGetInstalledPlugins({
      address,
      query: { refetchOnMount: true, enabled: !!address && !!bytecode },
    });
  const plugin = exaPluginAddress[chainId as keyof typeof exaPluginAddress];
  const { data: pluginManifest } = useReadExaPluginPluginManifest();
  const isLatestPlugin = installedPlugins?.[0] === plugin;
  const { data: uninstallPluginSimulation } = useSimulateUpgradeableModularAccountUninstallPlugin({
    address,
    args: [installedPlugins?.[0] ?? zeroAddress, "0x", "0x"],
    query: { enabled: !!address && !!installedPlugins?.[0] && !!bytecode && !isLatestPlugin },
  });
  const isReady =
    !!bytecode && !!installedPlugins?.[0] && !!pluginManifest && !!uninstallPluginSimulation && !isLatestPlugin;
  const { mutateAsync: updatePlugin, isPending: isUpdating } = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("no account address");
      if (!installedPlugins?.[0]) throw new Error("no installed plugin");
      if (!uninstallPluginSimulation) throw new Error("no uninstall plugin simulation");
      if (!pluginManifest) throw new Error("invalid manifest");

      const { id } = await mutateSendCalls({
        calls: [
          { ...uninstallPluginSimulation.request, to: address },
          {
            to: address,
            abi: upgradeableModularAccountAbi,
            functionName: "installPlugin",
            args: [
              plugin,
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
      const { status } = await waitForCallsStatus(exa, { id });
      if (status === "failure") throw new Error("failed to upgrade plugin");
    },
    onSuccess: async () => {
      await refetchInstalledPlugins();
    },
  });

  if (!isReady) return null;

  return (
    <InfoAlert
      title={t("An account upgrade is required to access the latest features.")}
      actionText={t("Upgrade account now")}
      loading={isUpdating}
      onPress={() => {
        updatePlugin().catch(reportError);
      }}
    />
  );
}
