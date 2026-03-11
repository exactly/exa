import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { LinearGradient } from "expo-linear-gradient";

import { ArrowDown, X } from "@tamagui/lucide-icons";
import { ScrollView, Square, styled, useTheme, XStack, YStack } from "tamagui";

import { formatUnits } from "viem";

import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import AssetLogo from "../shared/AssetLogo";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Token } from "@lifi/sdk";

export default function Failure({
  fromUsdAmount,
  fromAmount,
  fromToken,
  toUsdAmount,
  toAmount,
  toToken,
  onClose,
}: {
  fromAmount: bigint;
  fromToken: Token;
  fromUsdAmount: number;
  onClose: () => void;
  toAmount: bigint;
  toToken: Token;
  toUsdAmount: number;
}) {
  const theme = useTheme();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <View fullScreen backgroundColor="$backgroundSoft">
      <StyledGradient
        locations={[0.5, 1]}
        position="absolute"
        top={0}
        left={0}
        right={0}
        height={220}
        opacity={0.2}
        colors={[theme.uiErrorSecondary.val, theme.backgroundSoft.val]}
      />
      <SafeView flex={1} backgroundColor="transparent">
        <ScrollView showsVerticalScrollIndicator={false} flex={1} padding="$s4">
          <YStack gap="$s7" paddingBottom="$s9">
            <Pressable
              onPress={() => {
                queryClient.invalidateQueries({ queryKey: ["swap"] }).catch(reportError);
                onClose();
              }}
              aria-label={t("Close")}
            >
              <X size={24} color="$uiNeutralPrimary" />
            </Pressable>
            <XStack justifyContent="center" alignItems="center">
              <Square borderRadius="$r4" backgroundColor="$interactiveBaseErrorSoftDefault" size={80}>
                <X size={48} color="$uiErrorSecondary" strokeWidth={2} />
              </Square>
            </XStack>
            <YStack gap="$s4_5" justifyContent="center" alignItems="center">
              <Text secondary body>
                {t("Failed")}
              </Text>
              <Text title primary color="$uiNeutralPrimary">
                {`$${fromUsdAmount.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </Text>
              <XStack gap="$s2" alignItems="center">
                <Text emphasized secondary subHeadline>
                  {Number(formatUnits(fromAmount, fromToken.decimals)).toFixed(8)}
                </Text>
                <Text emphasized secondary subHeadline>
                  {fromToken.symbol}
                </Text>
                <AssetLogo symbol={fromToken.symbol} width={16} height={16} />
              </XStack>
              <ArrowDown size={24} color="$uiNeutralPrimary" />
              <Text title primary color="$uiNeutralPrimary">
                {`$${toUsdAmount.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </Text>
              <XStack gap="$s2" alignItems="center">
                <Text emphasized secondary subHeadline>
                  {Number(formatUnits(toAmount, toToken.decimals)).toFixed(8)}
                </Text>
                <Text emphasized secondary subHeadline>
                  {toToken.symbol}
                </Text>
                <AssetLogo symbol={toToken.symbol} width={16} height={16} />
              </XStack>
            </YStack>
          </YStack>
        </ScrollView>
        <YStack alignItems="center" gap="$s4" padding="$s4">
          <Pressable
            onPress={() => {
              queryClient.invalidateQueries({ queryKey: ["swap"] }).catch(reportError);
              onClose();
            }}
          >
            <Text emphasized footnote color="$uiBrandSecondary">
              {t("Close")}
            </Text>
          </Pressable>
        </YStack>
      </SafeView>
    </View>
  );
}

const StyledGradient = styled(LinearGradient, {});
