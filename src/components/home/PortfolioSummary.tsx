import { ChevronRight, TrendingUp } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React from "react";
import { XStack, YStack } from "tamagui";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import assetLogos from "../../utils/assetLogos";
import isProcessing from "../../utils/isProcessing";
import reportError from "../../utils/reportError";
import { getActivity } from "../../utils/server";
import useIntercom from "../../utils/useIntercom";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";

export default function PortfolioSummary({
  averageRate,
  portfolio,
}: {
  averageRate: bigint;
  portfolio: { usdBalance: bigint; depositMarkets: { market: string; symbol: string; usdValue: bigint }[] };
}) {
  const { usdBalance, depositMarkets } = portfolio;
  const navigation = useNavigation<AppNavigationProperties>();
  const { presentArticle } = useIntercom();
  const { data: country } = useQuery({ queryKey: ["user", "country"] });

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
          Your portfolio
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
          <Text emphasized subHeadline secondary>{`Processing balance ${processingBalance.toLocaleString(undefined, {
            style: "currency",
            currency: "USD",
            currencyDisplay: "narrowSymbol",
          })}`}</Text>
          <ChevronRight size={16} color="$uiNeutralSecondary" />
        </XStack>
      ) : (
        <XStack
          backgroundColor="$interactiveBaseSuccessSoftDefault"
          padding="$s3"
          borderRadius="$r_0"
          gap="$s2"
          alignItems="center"
          cursor="pointer"
          onPress={(event) => {
            event.stopPropagation();
            presentArticle("12633694").catch(reportError);
          }}
        >
          <TrendingUp size={16} color="$interactiveOnBaseBrandSoft" />
          <Text emphasized caption color="$interactiveOnBaseBrandSoft" textAlign="left">
            {`${(Number(averageRate) / 1e18).toLocaleString(undefined, {
              style: "percent",
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })} APR`}
          </Text>
          <XStack alignItems="center">
            {depositMarkets.map(({ market, symbol }, index, array) => {
              const uri = assetLogos[symbol as keyof typeof assetLogos];
              return (
                <XStack key={market} marginRight={index < array.length - 1 ? -6 : 0} zIndex={array.length - index}>
                  <AssetLogo uri={uri} width={16} height={16} />
                </XStack>
              );
            })}
          </XStack>
        </XStack>
      )}
    </YStack>
  );
}
