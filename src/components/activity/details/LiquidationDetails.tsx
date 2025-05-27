import type { LiquidationActivity } from "@exactly/server/api/activity";
import React from "react";
import { Separator, XStack, YStack } from "tamagui";

import assetLogos from "../../../utils/assetLogos";
import useAsset from "../../../utils/useAsset";
import AssetLogo from "../../shared/AssetLogo";
import Text from "../../shared/Text";

export default function LiquidationDetails({ item }: { item: Omit<LiquidationActivity, "blockNumber"> }) {
  const { amount, currency, seizedAssets, seizedMarket } = item;
  const { market } = useAsset(seizedMarket);

  const symbol = market ? (market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3)) : null;
  const seizedAmount = market ? Number(seizedAssets) / 10 ** market.decimals : 0;

  return (
    <YStack gap="$s4">
      <YStack gap="$s4">
        <Text emphasized headline>
          Forced repayment details
        </Text>
        <Separator height={1} borderColor="$borderNeutralSoft" />
      </YStack>
      <YStack gap="$s3_5">
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Repayment amount
          </Text>
          <XStack alignItems="center" gap="$s3">
            <AssetLogo uri={assetLogos[currency as keyof typeof assetLogos]} width={16} height={16} />
            <Text callout>
              {Number(amount).toLocaleString(undefined, {
                maximumFractionDigits: 2,
                minimumFractionDigits: 0,
              })}
            </Text>
          </XStack>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Seized market
          </Text>
          <XStack alignItems="center" gap="$s3">
            <AssetLogo uri={assetLogos[symbol as keyof typeof assetLogos]} width={16} height={16} />
            <Text callout>{symbol}</Text>
          </XStack>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Seized amount
          </Text>
          <XStack alignItems="center" gap="$s3">
            <AssetLogo uri={assetLogos[symbol as keyof typeof assetLogos]} width={16} height={16} />
            <Text callout>
              {seizedAmount.toLocaleString(undefined, {
                maximumFractionDigits: 8,
                minimumFractionDigits: 0,
              })}
            </Text>
          </XStack>
        </XStack>
      </YStack>
    </YStack>
  );
}
