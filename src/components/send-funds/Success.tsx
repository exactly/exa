import { exaPluginAddress } from "@exactly/common/generated/chain";
import { Check } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React from "react";
import { Image } from "react-native";
import { Square, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import type { WithdrawDetails } from "./Amount";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import type { Withdraw } from "../../utils/queryClient";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import GradientScrollView from "../shared/GradientScrollView";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import TransactionDetails from "../shared/TransactionDetails";
import View from "../shared/View";

export default function Success({
  details: { name: assetName, amount, usdValue },
  hash,
}: {
  details: WithdrawDetails;
  hash?: string;
}) {
  const { data: withdraw } = useQuery<Withdraw>({ queryKey: ["withdrawal"] });
  const { externalAsset } = useAsset(withdraw?.market);
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: address ?? zeroAddress,
    query: { enabled: !!address && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  return (
    <GradientScrollView variant={isLatestPlugin ? "info" : "success"}>
      <YStack gap="$s4" flex={1} justifyContent="space-between">
        <YStack gap="$s7" paddingBottom="$s9">
          <XStack justifyContent="center" alignItems="center">
            <Square
              size={80}
              borderRadius="$r4"
              backgroundColor={
                isLatestPlugin ? "$interactiveBaseInformationSoftDefault" : "$interactiveBaseSuccessSoftDefault"
              }
            >
              {isLatestPlugin ? (
                <ExaSpinner backgroundColor="transparent" color="$uiInfoSecondary" />
              ) : (
                <Check size={48} color="$uiSuccessSecondary" strokeWidth={2} />
              )}
            </Square>
          </XStack>
          <YStack gap="$s4_5" justifyContent="center" alignItems="center">
            <Text secondary body>
              {isLatestPlugin ? "Processing" : "Paid"}&nbsp;
              <Text emphasized primary body color="$uiNeutralPrimary">
                Withdrawal
              </Text>
            </Text>
            <Text title primary color="$uiNeutralPrimary">
              {Number(usdValue).toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                currencyDisplay: "narrowSymbol",
              })}
            </Text>
            <XStack gap="$s2" alignItems="center">
              <Text emphasized secondary subHeadline>
                {Number(amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}
              </Text>
              <Text emphasized secondary subHeadline>
                &nbsp;{assetName}&nbsp;
              </Text>
              {externalAsset ? (
                <Image source={{ uri: externalAsset.logoURI }} width={16} height={16} borderRadius={20} />
              ) : (
                <AssetLogo uri={assetLogos[assetName as keyof typeof assetLogos]} width={16} height={16} />
              )}
            </XStack>
          </YStack>
          <TransactionDetails hash={hash} />
        </YStack>
        <View padded alignItems="center">
          <Text
            emphasized
            footnote
            color="$interactiveBaseBrandDefault"
            alignSelf="center"
            hitSlop={20}
            cursor="pointer"
            onPress={() => {
              if (!externalAsset && isLatestPlugin) {
                router.replace("/pending-proposals");
              } else {
                router.replace("/");
              }
            }}
          >
            {!externalAsset && isLatestPlugin ? "View pending requests" : "Close"}
          </Text>
        </View>
      </YStack>
    </GradientScrollView>
  );
}
