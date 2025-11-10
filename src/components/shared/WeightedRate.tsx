import { TrendingUp } from "@tamagui/lucide-icons";
import React from "react";
import type { GestureResponderEvent } from "react-native";
import { XStack } from "tamagui";

import AssetLogo from "./AssetLogo";
import Text from "./Text";
import assetLogos from "../../utils/assetLogos";

export default function WeightedRate({
  averageRate,
  depositMarkets,
  displayLogos = false,
  onPress,
}: {
  averageRate: bigint;
  depositMarkets: { market: string; symbol: string }[];
  displayLogos?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
}) {
  return (
    <XStack
      backgroundColor="$interactiveBaseSuccessSoftDefault"
      padding="$s3"
      borderRadius="$r_0"
      gap="$s2"
      alignItems="center"
      cursor="pointer"
      onPress={onPress}
    >
      <TrendingUp size={16} color="$interactiveOnBaseBrandSoft" />
      <Text emphasized caption color="$interactiveOnBaseBrandSoft" textAlign="left">
        {`${(Number(averageRate) / 1e18).toLocaleString(undefined, {
          style: "percent",
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })} APR`}
      </Text>
      {displayLogos && (
        <XStack alignItems="center">
          {depositMarkets.map(({ market, symbol }, index, array) => {
            const uri = assetLogos[symbol as keyof typeof assetLogos];
            return (
              <XStack key={market} marginRight={index < array.length - 1 ? -6 : 0} zIndex={array.length - index}>
                <AssetLogo source={{ uri }} width={16} height={16} />
              </XStack>
            );
          })}
        </XStack>
      )}
    </XStack>
  );
}
