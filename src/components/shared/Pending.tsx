import { marketUSDCAddress } from "@exactly/common/generated/chain";
import type { Hex } from "@exactly/common/validation";
import { X } from "@tamagui/lucide-icons";
import { format, isAfter } from "date-fns";
import React from "react";
import { Pressable } from "react-native";
import { Square, XStack, YStack } from "tamagui";

import GradientScrollView from "./GradientScrollView";
import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Pending({
  amount,
  repayAssets,
  currency,
  maturity,
  selectedAsset,
  onClose,
}: {
  amount: number;
  repayAssets: bigint;
  currency?: string;
  maturity: bigint;
  selectedAsset?: Hex;
  onClose: () => void;
}) {
  const { externalAsset } = useAsset(selectedAsset);
  return (
    <GradientScrollView variant="neutral">
      <View flex={1}>
        <YStack gap="$s7" paddingBottom="$s9">
          <Pressable onPress={onClose}>
            <X size={24} color="$uiNeutralPrimary" />
          </Pressable>
          <XStack justifyContent="center" alignItems="center">
            <Square borderRadius="$r4" backgroundColor="$backgroundStrong" size={80}>
              <ExaSpinner backgroundColor="transparent" color="$uiNeutralPrimary" />
            </Square>
          </XStack>
          <YStack gap="$s4_5" justifyContent="center" alignItems="center">
            <Text secondary body>
              Processing&nbsp;
              <Text
                emphasized
                primary
                body
                color={
                  isAfter(new Date(Number(maturity) * 1000), new Date()) ? "$uiNeutralPrimary" : "$uiErrorSecondary"
                }
              >
                {`Due ${format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}`}
              </Text>
            </Text>
            <XStack gap="$s2" alignItems="center">
              <Text title primary color="$uiNeutralPrimary">
                {(Number(repayAssets) / 1e6).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                  useGrouping: false,
                })}
              </Text>
              <Text title primary color="$uiNeutralPrimary">
                &nbsp;USDC&nbsp;
              </Text>
              <AssetLogo uri={assetLogos.USDC} width={28} height={28} />
            </XStack>
            {currency !== "USDC" && (
              <XStack gap="$s2" alignItems="center">
                <Text headline primary color="$uiNeutralPrimary">
                  with&nbsp;
                </Text>
                <Text title2 primary color="$uiNeutralPrimary">
                  {amount.toLocaleString(undefined, {
                    maximumFractionDigits: selectedAsset && selectedAsset === marketUSDCAddress ? 2 : 8,
                  })}
                </Text>
                <Text title2 primary color="$uiNeutralPrimary">
                  &nbsp;{currency}&nbsp;
                </Text>
                <AssetLogo
                  {...(externalAsset
                    ? {
                        external: true,
                        source: { uri: externalAsset.logoURI },
                        width: 22,
                        height: 22,
                        borderRadius: 20,
                      }
                    : { uri: assetLogos[currency as keyof typeof assetLogos], width: 22, height: 22 })}
                />
              </XStack>
            )}
          </YStack>
        </YStack>
      </View>
    </GradientScrollView>
  );
}
