import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Check, X } from "@tamagui/lucide-icons";
import { Square, XStack, YStack } from "tamagui";

import { isAfter } from "date-fns";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import { exaPluginAddress, marketUSDCAddress } from "@exactly/common/generated/chain";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "@exactly/common/generated/hooks";

import GradientScrollView from "./GradientScrollView";
import SafeView from "./SafeView";
import View from "./View";
import assetLogos from "../../utils/assetLogos";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";
import TransactionDetails from "../shared/TransactionDetails";

import type { Hex } from "@exactly/common/validation";

export default function Success({
  amount,
  repayAssets,
  currency,
  maturity,
  selectedAsset,
  onClose,
}: {
  amount: number;
  currency?: string;
  maturity: bigint;
  onClose: () => void;
  repayAssets: bigint;
  selectedAsset?: Hex;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { externalAsset } = useAsset(selectedAsset);
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: address ?? zeroAddress,
    query: { enabled: !!address && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  return (
    <GradientScrollView variant={isLatestPlugin ? "info" : "success"}>
      <SafeView flex={1} backgroundColor="transparent">
        <YStack gap="$s5" justifyContent="space-between">
          <YStack>
            <Pressable onPress={onClose}>
              <X size={24} color="$uiNeutralPrimary" />
            </Pressable>
            <YStack gap="$s7" paddingBottom="$s9">
              <XStack justifyContent="center" alignItems="center">
                <Square
                  borderRadius="$r4"
                  backgroundColor={
                    isLatestPlugin ? "$interactiveBaseInformationSoftDefault" : "$interactiveBaseSuccessSoftDefault"
                  }
                  size={80}
                >
                  <Check size={48} color="$uiSuccessSecondary" strokeWidth={2} />
                </Square>
              </XStack>
              <YStack gap="$s4_5" justifyContent="center" alignItems="center">
                <Text secondary body>
                  {isLatestPlugin ? t("Processing") : t("Paid")}&nbsp;
                  <Text
                    emphasized
                    primary
                    body
                    color={
                      isAfter(new Date(Number(maturity) * 1000), new Date()) ? "$uiNeutralPrimary" : "$uiErrorSecondary"
                    }
                  >
                    {t("Due {{date}}", {
                      date: new Date(Number(maturity) * 1000).toLocaleDateString(language, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      }),
                    })}
                  </Text>
                </Text>
                <XStack gap="$s2" alignItems="center">
                  <Text title primary color="$uiNeutralPrimary">
                    {(Number(repayAssets) / 1e6).toLocaleString(language, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                      useGrouping: false,
                    })}
                  </Text>
                  <Text title primary color="$uiNeutralPrimary">
                    &nbsp;USDC&nbsp;
                  </Text>
                  <AssetLogo source={{ uri: assetLogos.USDC }} width={28} height={28} />
                </XStack>
                {currency !== "USDC" && (
                  <XStack gap="$s2" alignItems="center">
                    <Text headline primary color="$uiNeutralPrimary">
                      {t("with")}&nbsp;
                    </Text>
                    <Text title2 primary color="$uiNeutralPrimary">
                      {amount.toLocaleString(language, {
                        maximumFractionDigits: selectedAsset && selectedAsset === marketUSDCAddress ? 2 : 8,
                      })}
                    </Text>
                    <Text title2 primary color="$uiNeutralPrimary">
                      &nbsp;{currency}&nbsp;
                    </Text>
                    <AssetLogo
                      height={22}
                      source={{
                        uri: externalAsset
                          ? externalAsset.logoURI
                          : currency
                            ? assetLogos[currency as keyof typeof assetLogos]
                            : undefined,
                      }}
                      width={22}
                    />
                  </XStack>
                )}
              </YStack>
            </YStack>
            <TransactionDetails />
          </YStack>
        </YStack>
        <View flex={2} justifyContent="flex-end">
          <YStack alignItems="center" gap="$s4">
            <Pressable onPress={onClose}>
              <Text emphasized footnote color="$uiBrandSecondary">
                {t("Close")}
              </Text>
            </Pressable>
          </YStack>
        </View>
      </SafeView>
    </GradientScrollView>
  );
}
