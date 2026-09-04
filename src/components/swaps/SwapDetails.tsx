import React from "react";
import { useTranslation } from "react-i18next";

import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";

import type { Token } from "@lifi/sdk";

export default function SwapDetails({
  exchange,
  fee,
  slippage,
  exchangeRate,
  fromToken,
  toToken,
  networkFeeUSD,
  duration,
}: {
  duration?: number;
  exchange: string;
  exchangeRate: number;
  fee?: number;
  fromToken: Token;
  networkFeeUSD?: number;
  slippage: bigint;
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
          {networkFeeUSD ? (
            <Text caption color="$uiNeutralPrimary">
              {`$${networkFeeUSD.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </Text>
          ) : (
            <Text caption color="$uiSuccessSecondary">
              {t("FREE")}
            </Text>
          )}
        </XStack>
        {duration === undefined ? null : (
          <XStack justifyContent="space-between">
            <Text caption color="$uiNeutralSecondary">
              {t("Estimated time")}
            </Text>
            <Text caption color="$uiNeutralPrimary">
              {t("~{{minutes}} min", { minutes: Math.max(1, Math.round(duration / 60)) })}
            </Text>
          </XStack>
        )}
        <XStack justifyContent="space-between">
          <Text caption color="$uiNeutralSecondary">
            {t("Swap via")}
          </Text>
          <Text caption color="$uiNeutralPrimary" textTransform="uppercase">
            {exchange}
          </Text>
        </XStack>
        {fee === undefined ? null : (
          <XStack justifyContent="space-between">
            <Text caption color="$uiNeutralSecondary">
              {t("Swap fee")}
            </Text>
            <Text caption color="$uiNeutralPrimary">
              {fee.toLocaleString(language, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 3 })}
            </Text>
          </XStack>
        )}
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
