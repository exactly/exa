import React from "react";
import { useTranslation } from "react-i18next";
import type { GestureResponderEvent } from "react-native";

import { TrendingUp } from "@tamagui/lucide-icons-2";
import { XStack } from "tamagui";

import AssetLogo from "./AssetLogo";
import Text from "./Text";

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
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <XStack gap="$s2" alignItems="center" cursor="pointer" onPress={onPress}>
      <TrendingUp size={20} color="$interactiveOnBaseSuccessSoft" />
      <Text emphasized subHeadline color="$interactiveOnBaseSuccessSoft" textAlign="left">
        {t("{{rate}} APR", {
          rate: (Number(averageRate) / 1e18).toLocaleString(language, {
            style: "percent",
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          }),
        })}
      </Text>
      {displayLogos && (
        <XStack alignItems="center">
          {depositMarkets.map(({ market, symbol }, index, array) => (
            <XStack key={market} marginRight={index < array.length - 1 ? -6 : 0} zIndex={array.length - index}>
              <AssetLogo symbol={symbol} width={16} height={16} />
            </XStack>
          ))}
        </XStack>
      )}
    </XStack>
  );
}
