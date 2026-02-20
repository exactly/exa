import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ChevronRight } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import { selectBalance } from "../../utils/isProcessing";
import Text from "../shared/Text";
import WeightedRate from "../shared/WeightedRate";

import type { ActivityItem } from "../../utils/queryClient";

export default function PortfolioSummary({
  averageRate,
  balanceUSD,
  depositMarkets,
  totalBalanceUSD,
}: {
  averageRate: bigint;
  balanceUSD: bigint;
  depositMarkets: { market: string; symbol: string; usdValue: bigint }[];
  totalBalanceUSD: bigint;
}) {
  const router = useRouter();
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  const {
    t,
    i18n: { language },
  } = useTranslation();

  const { data: processingBalance } = useQuery<ActivityItem[], Error, number>({
    queryKey: ["activity"],
    enabled: country === "US",
    select: selectBalance,
  });
  return (
    <YStack
      gap="$s5"
      alignItems="center"
      cursor="pointer"
      hitSlop={20}
      onPress={() => {
        router.push("/portfolio");
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
      >
        {`$${(Number(totalBalanceUSD) / 1e18).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
      </Text>
      {country === "US" && processingBalance ? (
        <XStack
          borderWidth={1}
          borderColor="$borderNeutralSoft"
          borderRadius="$r_0"
          padding="$s3"
          cursor="pointer"
          hitSlop={20}
          onPress={() => {
            router.push("/activity");
          }}
          gap="$s2"
          alignItems="center"
        >
          <Text emphasized subHeadline secondary>
            {t("Processing balance {{amount}}", {
              amount: `$${processingBalance.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            })}
          </Text>
          <ChevronRight size={16} color="$uiNeutralSecondary" />
        </XStack>
      ) : balanceUSD > 0n ? (
        <WeightedRate displayLogos averageRate={averageRate} depositMarkets={depositMarkets} />
      ) : null}
    </YStack>
  );
}
