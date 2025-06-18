import type { Token } from "@lifi/sdk";
import React from "react";
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
  return (
    <YStack gap="$s4" paddingHorizontal="$s4">
      <YStack gap="$s3_5">
        <XStack justifyContent="space-between">
          <Text caption color="$uiNeutralSecondary">
            Exchange rate
          </Text>
          <Text caption color="$uiNeutralPrimary">
            1 {fromToken.symbol} = {exchangeRate.toFixed(2)} {toToken.symbol}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text caption color="$uiNeutralSecondary">
            Network fee
          </Text>
          <Text caption color="$uiSuccessSecondary">
            FREE
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text caption color="$uiNeutralSecondary">
            Swap via
          </Text>
          <Text caption color="$uiNeutralPrimary" textTransform="uppercase">
            {exchange}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text caption color="$uiNeutralSecondary">
            Swap fee
          </Text>
          <Text caption color="$uiNeutralPrimary">
            0.025%
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text caption color="$uiNeutralSecondary">
            Max slippage
          </Text>
          <Text caption color="$uiNeutralPrimary">
            {(Number(slippage) * 100) / 1000}%
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
}
