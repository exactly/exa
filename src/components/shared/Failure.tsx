import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { X } from "@tamagui/lucide-icons";
import { Square, XStack, YStack } from "tamagui";

import { marketUSDCAddress } from "@exactly/common/generated/chain";

import GradientScrollView from "./GradientScrollView";
import IconButton from "./IconButton";
import SafeView from "./SafeView";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Hex } from "@exactly/common/validation";

export default function Failure({
  amount,
  repayAssets,
  currency,
  maturity,
  timestamp,
  selectedAsset,
  onClose,
}: {
  amount: number;
  currency?: string;
  maturity: bigint;
  onClose: () => void;
  repayAssets: bigint;
  selectedAsset?: Hex;
  timestamp: bigint;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <GradientScrollView variant="error">
      <SafeView flex={1} backgroundColor="transparent">
        <YStack gap="$s7" paddingBottom="$s9">
          <IconButton icon={X} aria-label={t("Close")} onPress={onClose} />
          <XStack justifyContent="center" alignItems="center">
            <Square borderRadius="$r4" backgroundColor="$interactiveBaseErrorSoftDefault" size={80}>
              <X size={48} color="$uiErrorSecondary" strokeWidth={2} />
            </Square>
          </XStack>
          <YStack gap="$s4_5" justifyContent="center" alignItems="center">
            <Text secondary body>
              {t("Failed")}&nbsp;
              <Text emphasized primary body color={maturity <= timestamp ? "$uiErrorSecondary" : "$uiNeutralPrimary"}>
                {t("Due {{date}}", {
                  date: useMemo(
                    () =>
                      new Date(Number(maturity) * 1000).toLocaleDateString(language, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      }),
                    [maturity, language],
                  ),
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
                    maximumFractionDigits: selectedAsset === marketUSDCAddress ? 2 : 8,
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
