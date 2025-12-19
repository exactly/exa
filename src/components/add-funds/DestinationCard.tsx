import shortenHex from "@exactly/common/shortenHex";
import { WAD } from "@exactly/lib";
import type { Token } from "@lifi/sdk";
import React from "react";
import { Pressable } from "react-native";
import { XStack, YStack } from "tamagui";
import { formatUnits, parseUnits } from "viem";

import TokenLogo from "./TokenLogo";
import OptimismImage from "../../assets/images/optimism.svg";
import AssetLogo from "../shared/AssetLogo";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function DestinationCard({
  token,
  balance,
  toAmount,
  account,
  isSameChain,
  isLoadingQuote,
  onPress,
  canSelect,
  destinationModalOpen,
}: {
  token: Token;
  balance: bigint;
  toAmount: bigint;
  account: string;
  isSameChain: boolean;
  isLoadingQuote: boolean;
  onPress: () => void;
  canSelect: boolean;
  destinationModalOpen: boolean;
}) {
  return (
    <YStack
      borderWidth={1}
      borderColor={destinationModalOpen ? "$borderBrandStrong" : "$borderNeutralSoft"}
      backgroundColor="$backgroundMild"
      borderRadius="$r3"
      padding="$s4_5"
      gap="$s3"
    >
      <XStack alignItems="center" justifyContent="space-between">
        <YStack gap="$s1">
          <Text emphasized subHeadline color="$uiNeutralPrimary">
            {isSameChain ? "Destination" : "Destination asset"}
          </Text>
          <Text footnote color="$uiNeutralSecondary">
            Exa Account | {shortenHex(account, 4, 6)}
          </Text>
        </YStack>
      </XStack>

      {!isSameChain && (
        <Pressable
          onPress={canSelect ? onPress : undefined}
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, width: "100%" })}
        >
          <XStack gap="$s3_5" alignItems="center">
            <View width={40} height={40} position="relative">
              {token.logoURI ? (
                <AssetLogo source={{ uri: token.logoURI }} width={40} height={40} />
              ) : (
                <TokenLogo token={token} size={40} />
              )}
              <View
                position="absolute"
                bottom={0}
                right={0}
                width={20}
                height={20}
                borderWidth={1}
                borderColor="white"
                borderRadius={10}
                overflow="hidden"
              >
                <OptimismImage width="100%" height="100%" />
              </View>
            </View>

            <YStack flex={1}>
              {isLoadingQuote ? (
                <Skeleton height={28} width="60%" />
              ) : (
                <Text primary emphasized title color="$uiNeutralSecondary">
                  {Number(formatUnits(toAmount, token.decimals)).toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: token.decimals,
                    useGrouping: false,
                  })}
                </Text>
              )}

              <XStack justifyContent="space-between" alignItems="center" flex={1}>
                {isLoadingQuote ? (
                  <Skeleton height={16} width={100} />
                ) : (
                  <Text callout color="$uiNeutralPlaceholder">
                    {`≈${Number(
                      formatUnits((toAmount * parseUnits(token.priceUSD, 18)) / WAD, token.decimals),
                    ).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      currencyDisplay: "narrowSymbol",
                    })}`}
                  </Text>
                )}

                <Text footnote color="$uiNeutralSecondary" textAlign="right">
                  {`Balance: ${Number(
                    formatUnits((balance * parseUnits(token.priceUSD, 18)) / WAD, token.decimals),
                  ).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })}`}
                </Text>
              </XStack>
            </YStack>
          </XStack>
        </Pressable>
      )}
    </YStack>
  );
}
