import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { X } from "@tamagui/lucide-icons";
import { Square, XStack, YStack } from "tamagui";

import { isAfter } from "date-fns";

import { marketUSDCAddress } from "@exactly/common/generated/chain";

import GradientScrollView from "./GradientScrollView";
import AssetLogo from "../shared/AssetLogo";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Hex } from "@exactly/common/validation";

export default function Pending({
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
              {t("Processing")}&nbsp;
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
              <AssetLogo symbol="USDC" width={28} height={28} />
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
                {currency && <AssetLogo height={22} width={22} symbol={currency} />}
              </XStack>
            )}
          </YStack>
        </YStack>
      </View>
    </GradientScrollView>
  );
}
