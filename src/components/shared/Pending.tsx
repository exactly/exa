import { marketUSDCAddress } from "@exactly/common/generated/chain";
import type { Hex } from "@exactly/common/validation";
import { format, isAfter } from "date-fns";
import React from "react";
import { Square, XStack, YStack } from "tamagui";

import GradientScrollView from "./GradientScrollView";
import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
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
  maturity: bigint;
  selectedAsset?: Hex;
}) {
  const { externalAsset } = useAsset(selectedAsset);
  return (
    <GradientScrollView variant="neutral">
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
                  isAfter(new Date(Number(maturity) * 1000), new Date()) ? "$uiNeutralPrimary" : "$uiErrorSecondary"
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
                {Number(amount).toLocaleString(undefined, {
                  maximumFractionDigits: selectedAsset && selectedAsset === marketUSDCAddress ? 2 : 8,
                })}
              </Text>
              <Text emphasized secondary subHeadline>
                &nbsp;{currency}&nbsp;
              </Text>
              <AssetLogo
                {...(externalAsset
                  ? { external: true, source: { uri: externalAsset.logoURI }, width: 16, height: 16, borderRadius: 20 }
                  : { uri: assetLogos[currency as keyof typeof assetLogos], width: 16, height: 16 })}
              />
            </XStack>
          </YStack>
        </YStack>
      </View>
    </GradientScrollView>
  );
}
