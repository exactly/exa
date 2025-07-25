import { useQuery } from "@tanstack/react-query";
import React from "react";
import { View, XStack, YStack } from "tamagui";

import { getActivity } from "../../utils/server";
import Text from "../shared/Text";

export default function SpendingLimit({ title, limit }: { amount?: number; title: string; limit: number }) {
  const { data: activity, isPending } = useQuery({
    queryKey: ["activity"],
    queryFn: () => getActivity(),
    select: (a) =>
      a.filter((item) => {
        if (item.type !== "panda") return false;
        const elapsedTime = (Date.now() - new Date(item.timestamp).getTime()) / 1000;
        return elapsedTime <= 604_800;
      }),
  });

  const totalSpent =
    isPending || !activity ? 0 : activity.reduce((accumulator, item) => accumulator + item.usdAmount, 0);
  const remaining = limit - totalSpent;

  return (
    <YStack justifyContent="flex-start" paddingHorizontal="$s3">
      <XStack flexDirection="row" flex={1} height={46} alignItems="center" justifyContent="space-between">
        <View flexDirection="row" gap={5} alignItems="center">
          <Text emphasized callout>
            {title}
          </Text>
          <Text callout color="$uiNeutralSecondary">
            →
          </Text>
          <Text callout sensitive color="$uiNeutralSecondary">
            {limit.toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
              maximumFractionDigits: 0,
            })}
          </Text>
        </View>
        <View flexDirection="row" gap={5} alignItems="center">
          <Text callout sensitive color="$uiBrandSecondary">
            {remaining.toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
              maximumFractionDigits: 0,
            })}
          </Text>
          <Text callout sensitive color="$uiBrandSecondary">
            left
          </Text>
        </View>
      </XStack>
      <XStack flexDirection="row" flex={1} height={8} alignItems="center" justifyContent="space-between">
        <View width="100%" height={8} borderRadius="$r_0" backgroundColor="$backgroundBrandMild">
          <View
            width={`${(totalSpent / limit) * 100}%`}
            height={8}
            borderRadius="$r_0"
            backgroundColor="$uiBrandSecondary"
          />
        </View>
      </XStack>
    </YStack>
  );
}
