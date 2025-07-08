import type { Token } from "@lifi/sdk";
import React from "react";
import { useTranslation } from "react-i18next";
import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";

export default function SwapDetails({
  exchange,
  slippage,
  exchangeRate,
  fromToken,
  toToken,
}: {
  exchange: string;
  slippage: bigint;
  exchangeRate: number;
  fromToken: Token;
  toToken: Token;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <YStack gap="$s4" paddingHorizontal="$s4">
      <YStack gap="$s3_5">
        <XStack justifyContent="space-between">
          <Text caption color="$uiNeutralSecondary">
            {t("Exchange rate")}
          </Text>
          <Text caption color="$uiNeutralPrimary">
            1 {fromToken.symbol} ={" "}
            {exchangeRate.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
            {toToken.symbol}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text caption color="$uiNeutralSecondary">
            {t("Network fee")}
          </Text>
          <Text caption color="$uiSuccessSecondary">
            {t("FREE")}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text caption color="$uiNeutralSecondary">
            {t("Swap via")}
          </Text>
          <Text caption color="$uiNeutralPrimary" textTransform="uppercase">
            {exchange}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text caption color="$uiNeutralSecondary">
            {t("Swap fee")}
          </Text>
          <Text caption color="$uiNeutralPrimary">
            {(0.000_25).toLocaleString(language, {
              style: "percent",
              minimumFractionDigits: 3,
              maximumFractionDigits: 3,
            })}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text caption color="$uiNeutralSecondary">
            {t("Max slippage")}
          </Text>
          <Text caption color="$uiNeutralPrimary">
            {(Number(slippage) / 1000).toLocaleString(language, {
              style: "percent",
              minimumFractionDigits: 1,
              maximumFractionDigits: 2,
            })}
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
}
