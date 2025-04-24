import type { Address } from "@exactly/common/validation";
import { format, isAfter } from "date-fns";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Image } from "react-native";
import { ScrollView, Square, styled, useTheme, XStack, YStack } from "tamagui";

import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import SafeView from "../shared/SafeView";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Pending({
  usdAmount,
  amount,
  currency,
  maturity,
  selectedAsset,
}: {
  usdAmount: number;
  amount: number;
  currency?: string;
  maturity: string;
  selectedAsset: Address;
}) {
  const { externalAsset } = useAsset(selectedAsset);
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
          <View fullScreen>
            <ScrollView
              fullscreen
              showsVerticalScrollIndicator={false}
              stickyHeaderIndices={[0]}
              // eslint-disable-next-line react-native/no-inline-styles
              contentContainerStyle={{ flexGrow: 1, flexDirection: "column", justifyContent: "space-between" }}
              stickyHeaderHiddenOnScroll
            >
              <View flex={1}>
                <YStack gap="$s7" paddingBottom="$s9">
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
                          isAfter(new Date(Number(maturity) * 1000), new Date())
                            ? "$uiNeutralPrimary"
                            : "$uiErrorSecondary"
                        }
                      >
                        {`Due ${format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}`}
                      </Text>
                    </Text>
                    <Text title primary color="$uiNeutralPrimary">
                      {Number(usdAmount).toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                        currencyDisplay: "narrowSymbol",
                      })}
                    </Text>
                    <XStack gap="$s2" alignItems="center">
                      <Text emphasized secondary subHeadline>
                        {Number(amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}
                      </Text>
                      <Text emphasized secondary subHeadline>
                        &nbsp;{currency}&nbsp;
                      </Text>
                      {externalAsset ? (
                        <Image source={{ uri: externalAsset.logoURI }} width={16} height={16} borderRadius={20} />
                      ) : (
                        <AssetLogo uri={assetLogos[currency as keyof typeof assetLogos]} width={16} height={16} />
                      )}
                    </XStack>
                  </YStack>
                </YStack>
              </View>
            </ScrollView>
          </View>
        </View>
      </SafeView>
    </View>
  );
}

const StyledGradient = styled(LinearGradient, {});
