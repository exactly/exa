import React from "react";
import { useTranslation } from "react-i18next";

import { useMutation, useQuery } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import { encodeAbiParameters, getAbiItem, keccak256 } from "viem";
import { useBytecode, useSendCalls } from "wagmi";

import accountInit from "@exactly/common/accountInit";
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

import InfoAlert from "./InfoAlert";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import exa from "../../utils/wagmi/exa";

import type { Credential } from "@exactly/common/validation";

export default function PluginUpgrade() {
  const { t } = useTranslation();
  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const { address } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: bytecode } = useBytecode({ address, query: { enabled: !!address } });
  const { data: installedPlugins, refetch: refetchInstalledPlugins } =
    useReadUpgradeableModularAccountGetInstalledPlugins({
      address,
      factory: credential?.factory,
      factoryData: credential && accountInit(credential),
      query: { refetchOnMount: true, enabled: !!address && !!credential },
    });
  const { data: pluginManifest } = useReadExaPluginPluginManifest({ address: exaPluginAddress });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  const { data: uninstallPluginSimulation } = useSimulateUpgradeableModularAccountUninstallPlugin({
    address,
    args: installedPlugins?.[0] ? [installedPlugins[0], "0x", "0x"] : undefined,
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
      const { status } = await waitForCallsStatus(exa, { id });
      if (status === "failure") throw new Error("failed to upgrade plugin");
      if (credential) await refetchInstalledPlugins();
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
