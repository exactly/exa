import { ChevronRight } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { XStack, YStack } from "tamagui";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import isProcessing from "../../utils/isProcessing";
import { getActivity } from "../../utils/server";
import Text from "../shared/Text";
import WeightedRate from "../shared/WeightedRate";

export default function PortfolioSummary({
  averageRate,
  portfolio,
}: {
  averageRate: bigint;
  portfolio: { usdBalance: bigint; depositMarkets: { market: string; symbol: string; usdValue: bigint }[] };
}) {
  const { usdBalance, depositMarkets } = portfolio;
  const navigation = useNavigation<AppNavigationProperties>();
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  const { t } = useTranslation();

  const { data: processingBalance } = useQuery({
    queryKey: ["processing-balance"],
    queryFn: () => getActivity(),
    select: (activity) =>
      activity.reduce(
        (total, item) => (item.type === "panda" && isProcessing(item.timestamp) ? total + item.usdAmount : total),
        0,
      ),
    enabled: country === "US",
  });
  return (
    <YStack
      gap="$s5"
      alignItems="center"
      cursor="pointer"
      hitSlop={20}
      onPress={() => {
        navigation.navigate("portfolio/index");
      }}
    >
      <XStack alignItems="center" gap="$s2">
        <Text secondary emphasized subHeadline>
          {t("Your portfolio")}
        </Text>
        <ChevronRight size={16} color="$uiNeutralSecondary" />
      </XStack>
      <Text
        sensitive
        subHeadline
        emphasized
        overflow="hidden"
        maxFontSizeMultiplier={1}
        numberOfLines={1}
        adjustsFontSizeToFit
        fontFamily="$mono"
        fontSize={40}
        lineHeight={40}
      >
        {(Number(usdBalance) / 1e18).toLocaleString(undefined, {
          style: "currency",
          currency: "USD",
          currencyDisplay: "narrowSymbol",
        })}
      </Text>
      {processingBalance ? (
        <XStack
          borderWidth={1}
          borderColor="$borderNeutralSoft"
          borderRadius="$r_0"
          padding="$s3"
          cursor="pointer"
          hitSlop={20}
          onPress={() => {
            navigation.navigate("(home)", { screen: "activity" });
          }}
          gap="$s2"
          alignItems="center"
        >
          <Text emphasized subHeadline secondary>
            {t("Processing balance {{amount}}", {
              amount: processingBalance
                ? processingBalance.toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })
                : "",
            })}
          </Text>
          <ChevronRight size={16} color="$uiNeutralSecondary" />
        </XStack>
      ) : usdBalance > 0n ? (
        <WeightedRate displayLogos averageRate={averageRate} depositMarkets={depositMarkets} />
      ) : null}
    </YStack>
  );
}
