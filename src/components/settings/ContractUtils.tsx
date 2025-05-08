import { exaPluginAddress } from "@exactly/common/generated/chain";
import { useMutation } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import React from "react";
import { View, Spinner } from "tamagui";
import { encodeAbiParameters, encodeFunctionData, getAbiItem, keccak256, zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import {
  exaPluginAbi,
  upgradeableModularAccountAbi,
  useReadExaPluginPluginManifest,
  useReadUpgradeableModularAccountGetInstalledPlugins,
  useSimulateUpgradeableModularAccountUninstallPlugin,
} from "../../generated/contracts";
import { accountClient } from "../../utils/alchemyConnector";
import reportError from "../../utils/reportError";
import Button from "../shared/Button";
import Text from "../shared/Text";

function copyHash(hash: string | undefined) {
  if (!hash) return;
  setStringAsync(hash).catch(reportError);
}

export default function ContractUtils() {
  const { address } = useAccount();
  const { data: pluginManifest } = useReadExaPluginPluginManifest({ address: exaPluginAddress });
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: address ?? zeroAddress,
    query: { enabled: !!address && !!bytecode },
  });
  const { data: uninstallPluginSimulation } = useSimulateUpgradeableModularAccountUninstallPlugin({
    address,
    args: [installedPlugins?.[0] ?? zeroAddress, "0x", "0x"],
    query: { enabled: !!address && !!installedPlugins && !!bytecode },
  });

  const {
    data: updatePluginHash,
    mutateAsync: updatePlugin,
    isPending: isUpdating,
  } = useMutation({
    mutationFn: async () => {
      if (!accountClient) throw new Error("no account client");
      if (!address) throw new Error("no account address");
      if (!installedPlugins?.[0]) throw new Error("no installed plugin");
      if (!uninstallPluginSimulation) throw new Error("no uninstall plugin simulation");
      if (!pluginManifest) throw new Error("invalid manifest");
      const hash = await accountClient.sendUserOperation({
        uo: [
          { target: address, value: 0n, data: encodeFunctionData(uninstallPluginSimulation.request) },
          {
            target: address,
            value: 0n,
            data: encodeFunctionData({
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
            }),
          },
        ],
      });
      return accountClient.waitForUserOperationTransaction(hash);
    },
  });

  return (
    <View gap="$s4">
      <Text fontSize={16} subHeadline fontWeight="bold">
        Exactly
      </Text>
      {isUpdating && <Spinner color="$interactiveBaseBrandDefault" />}
      {updatePluginHash && (
        <View borderRadius="$r4" borderWidth={2} borderColor="$borderNeutralSoft" padding={10}>
          <Text textAlign="center" fontSize={14} fontFamily="$mono" width="100%">
            {updatePluginHash}
          </Text>
        </View>
      )}
      <View flexDirection="row" gap="$s4">
        <Button
          contained
          onPress={() => {
            updatePlugin().catch(reportError);
          }}
          padding={10}
          disabled={!uninstallPluginSimulation}
          flex={1}
        >
          Upgrade Plugin
        </Button>
        {updatePluginHash && (
          <Button
            outlined
            borderRadius="$r2"
            onPress={() => {
              copyHash(updatePluginHash);
            }}
            padding={10}
            flex={1}
          >
            Copy
          </Button>
        )}
      </View>
    </View>
  );
}
