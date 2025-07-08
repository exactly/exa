import { ChevronRight } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { XStack, YStack } from "tamagui";

import isProcessing from "../../utils/isProcessing";
import { getActivity } from "../../utils/server";
import Text from "../shared/Text";

export default function PortfolioSummary({ usdBalance }: { usdBalance: bigint }) {
  const { t } = useTranslation();
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
            router.push("/activity");
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
