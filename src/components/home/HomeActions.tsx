import { exaPluginAddress, upgradeableModularAccountAbi } from "@exactly/common/generated/chain";
import { ArrowDownToLine, ArrowUpRight } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React from "react";
import { PixelRatio } from "react-native";
import { Spinner, XStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount, useBytecode, useReadContract } from "wagmi";

import { useReadUpgradeableModularAccountGetInstalledPlugins } from "../../generated/contracts";
import reportError from "../../utils/reportError";
import Button from "../shared/Button";
import Text from "../shared/Text";

export default function HomeActions() {
  const fontScale = PixelRatio.getFontScale();
  const { address: account } = useAccount();
  const { data: bytecode } = useBytecode({ address: account ?? zeroAddress, query: { enabled: !!account } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: account ?? zeroAddress,
    query: { enabled: !!account && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  const { refetch: fetchProposals, isFetching } = useReadContract({
    functionName: "proposals",
    abi: [
      ...upgradeableModularAccountAbi,
      {
        type: "function",
        inputs: [{ name: "account", internalType: "address", type: "address" }],
        name: "proposals",
        outputs: [
          { name: "amount", internalType: "uint256", type: "uint256" },
          { name: "market", internalType: "contract IMarket", type: "address" },
          { name: "receiver", internalType: "address", type: "address" },
          { name: "timestamp", internalType: "uint256", type: "uint256" },
        ],
        stateMutability: "view",
      },
    ],
    address: installedPlugins?.[0],
    args: [account ?? zeroAddress],
    query: { enabled: !!account && !!installedPlugins?.[0] && !isLatestPlugin },
  });

  const handleSend = async () => {
    if (isLatestPlugin) {
      router.push("/send-funds");
    } else {
      if (isFetching) return;
      const { data: proposals } = await fetchProposals();
      const route = proposals && proposals[0] > 0n ? "/send-funds/processing" : "/send-funds";
      router.push(route);
    }
  };
  return (
    <XStack alignItems="center" gap="$s4">
      <Button
        main
        spaced
        onPress={() => {
          router.push("/add-funds/add-crypto");
        }}
        iconAfter={<ArrowDownToLine size={18 * fontScale} color="$interactiveOnBaseBrandDefault" />}
        backgroundColor="$interactiveBaseBrandDefault"
        color="$interactiveOnBaseBrandDefault"
        contained
        fullwidth
      >
        <Text fontSize={15} emphasized numberOfLines={1} adjustsFontSizeToFit color="$interactiveOnBaseBrandDefault">
          Add funds
        </Text>
      </Button>
      <Button
        main
        spaced
        onPress={() => {
          handleSend().catch(reportError);
        }}
        disabled={isLatestPlugin ? false : isFetching}
        iconAfter={
          isLatestPlugin || !isFetching ? (
            <ArrowUpRight size={18 * fontScale} color="$interactiveOnBaseBrandSoft" />
          ) : (
            <Spinner height={18 * fontScale} width={18 * fontScale} color="$interactiveOnBaseBrandSoft" />
          )
        }
        backgroundColor="$interactiveBaseBrandSoftDefault"
        color="$interactiveOnBaseBrandSoft"
        outlined
        fullwidth
      >
        <Text fontSize={15} emphasized numberOfLines={1} adjustsFontSizeToFit color="$interactiveOnBaseBrandSoft">
          Send
        </Text>
      </Button>
    </XStack>
  );
}
