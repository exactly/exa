import { ChevronRight } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React from "react";
import { XStack, YStack } from "tamagui";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import isProcessing from "../../utils/isProcessing";
import { getActivity } from "../../utils/server";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";

export default function PortfolioSummary({ usdBalance, loading = false }: { usdBalance: bigint; loading?: boolean }) {
  const navigation = useNavigation<AppNavigationProperties>();
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  const { data: processingBalance, isPending: isPendingProcessingBalance } = useQuery({
    queryKey: ["processing-balance"],
    queryFn: () => getActivity(),
    select: (activity) =>
      activity.reduce(
        (total, item) => (item.type === "panda" && isProcessing(item.timestamp) ? total + item.usdAmount : total),
        0,
      ),
    enabled: country === "US",
  });
  if (loading) {
    return <PortfolioSummarySkeleton showProcessing={country === "US" || country === undefined} />;
  }
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
      {country === "US" && isPendingProcessingBalance ? (
        <ProcessingSkeleton />
      ) : processingBalance ? (
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
      ) : null}
    </YStack>
  );
}

function PortfolioSummarySkeleton({ showProcessing }: { showProcessing: boolean }) {
  return (
    <YStack gap="$s5" alignItems="center" width="100%">
      <XStack alignItems="center" gap="$s2" alignSelf="flex-start">
        <Skeleton height={16} width={120} />
      </XStack>
      <Skeleton height={40} width="80%" />
      {showProcessing ? <ProcessingSkeleton /> : null}
    </YStack>
  );
}

function ProcessingSkeleton() {
  return (
    <XStack
      borderWidth={1}
      borderColor="$borderNeutralSoft"
      borderRadius="$r_0"
      padding="$s3"
      gap="$s3"
      alignItems="center"
      width="100%"
      justifyContent="space-between"
    >
      <Skeleton height={16} width="60%" />
      <Skeleton height={16} width={24} />
    </XStack>
  );
}
