import type { Token } from "@lifi/sdk";
import { ArrowDown, X } from "@tamagui/lucide-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Image, Pressable } from "react-native";
import { ScrollView, Square, styled, useTheme, XStack, YStack } from "tamagui";
import { formatUnits } from "viem";

import SafeView from "../shared/SafeView";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Pending({
  fromUsdAmount,
  fromAmount,
  fromToken,
  toUsdAmount,
  toAmount,
  toToken,
  onClose,
}: {
  fromUsdAmount: number;
  fromAmount: bigint;
  fromToken: Token;
  toUsdAmount: number;
  toAmount: bigint;
  toToken: Token;
  onClose: () => void;
}) {
  const theme = useTheme();

  return (
    <View fullScreen backgroundColor="$backgroundSoft">
      <StyledGradient
        locations={[0.5, 1]}
        position="absolute"
        top={0}
        left={0}
        right={0}
        height={220}
        opacity={0.8}
        colors={[theme.backgroundStrong.val, theme.backgroundSoft.val]}
      />
      <SafeView backgroundColor="transparent">
        <View fullScreen padded>
          <ScrollView
            showsVerticalScrollIndicator={false}
            stickyHeaderIndices={[0]}
            contentContainerStyle={{ flexGrow: 1, flexDirection: "column", justifyContent: "space-between" }}
            stickyHeaderHiddenOnScroll
          >
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
                    Processing{" "}
                    <Text secondary body emphasized>
                      swap request
                    </Text>
                  </Text>
                  <Text title primary color="$uiNeutralPrimary">
                    {fromUsdAmount.toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      currencyDisplay: "narrowSymbol",
                    })}
                  </Text>
                  <XStack gap="$s2" alignItems="center">
                    <Image source={{ uri: fromToken.logoURI }} width={16} height={16} borderRadius={20} />
                    <Text emphasized secondary subHeadline>
                      {Number(formatUnits(fromAmount, fromToken.decimals)).toFixed(8)}
                    </Text>
                  </XStack>
                  <ArrowDown size={24} color="$interactiveBaseBrandDefault" />
                  <Text title primary color="$uiNeutralPrimary">
                    {toUsdAmount.toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      currencyDisplay: "narrowSymbol",
                    })}
                  </Text>
                  <XStack gap="$s2" alignItems="center">
                    <Image source={{ uri: toToken.logoURI }} width={16} height={16} borderRadius={20} />
                    <Text emphasized secondary subHeadline>
                      {Number(formatUnits(toAmount, toToken.decimals)).toFixed(8)}
                    </Text>
                  </XStack>
                </YStack>
              </YStack>
            </View>
          </ScrollView>
        </View>
      </SafeView>
    </View>
  );
}

const StyledGradient = styled(LinearGradient, {});
