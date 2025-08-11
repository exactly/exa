import type { Token } from "@lifi/sdk";
import { ArrowDown, ArrowRight } from "@tamagui/lucide-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "expo-router";
import React from "react";
import { Pressable, Image } from "react-native";
import { ScrollView, Square, styled, useTheme, XStack, YStack } from "tamagui";
import { formatUnits } from "viem";

import type { AppNavigationProperties } from "../../app/(app)/_layout";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import TransactionDetails from "../shared/TransactionDetails";
import View from "../shared/View";

export default function Success({
  fromUsdAmount,
  fromAmount,
  fromToken,
  toUsdAmount,
  toAmount,
  toToken,
}: {
  fromUsdAmount: number;
  fromAmount: bigint;
  fromToken: Token;
  toUsdAmount: number;
  toAmount: bigint;
  toToken: Token;
}) {
  const theme = useTheme();
  const navigation = useNavigation<AppNavigationProperties>();
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
        colors={[theme.uiInfoSecondary.val, theme.backgroundSoft.val]}
      />
      <SafeView backgroundColor="transparent">
        <View fullScreen padded>
          <ScrollView
            showsVerticalScrollIndicator={false}
            stickyHeaderIndices={[0]}
            // eslint-disable-next-line react-native/no-inline-styles
            contentContainerStyle={{
              flexGrow: 1,
              flexDirection: "column",
              justifyContent: "space-between",
            }}
            stickyHeaderHiddenOnScroll
          >
            <View flex={1}>
              <YStack gap="$s7" paddingBottom="$s9">
                <XStack justifyContent="center" alignItems="center">
                  <Square borderRadius="$r4" backgroundColor="$interactiveBaseInformationSoftDefault" size={80}>
                    <ExaSpinner backgroundColor="transparent" color="$uiInfoSecondary" />
                  </Square>
                </XStack>
                <YStack gap="$s4_5" justifyContent="center" alignItems="center">
                  <Text secondary body>
                    Swap request{" "}
                    <Text secondary body emphasized>
                      sent
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
              <TransactionDetails />
            </View>
            <View flex={2} justifyContent="flex-end">
              <YStack alignItems="center" gap="$s4">
                <Button
                  onPress={() => {
                    queryClient.invalidateQueries({ queryKey: ["swap"] }).catch(reportError);
                    navigation.navigate("pending-proposals/index");
                  }}
                  contained
                  main
                  fullwidth
                  spaced
                  iconAfter={<ArrowRight size={16} />}
                >
                  View pending request
                </Button>
                <Pressable
                  onPress={() => {
                    queryClient.invalidateQueries({ queryKey: ["swap"] }).catch(reportError);
                    navigation.replace("(home)", { screen: "index" });
                  }}
                >
                  <Text emphasized footnote color="$uiBrandSecondary">
                    Close
                  </Text>
                </Pressable>
              </YStack>
            </View>
          </ScrollView>
        </View>
      </SafeView>
    </View>
  );
}

const StyledGradient = styled(LinearGradient, {});
