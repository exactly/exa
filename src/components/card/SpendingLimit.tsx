import { Skeleton } from "moti/skeleton";
import React from "react";
import { View, XStack, YStack } from "tamagui";

import Text from "../shared/Text";

export default function SpendingLimit({
  title,
  limit,
  totalSpent,
}: {
  title: string;
  limit?: number;
  totalSpent: number;
}) {
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
          {limit ? (
            <Text callout sensitive color="$uiNeutralSecondary">
              {limit.toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                currencyDisplay: "narrowSymbol",
                maximumFractionDigits: 0,
              })}
            </Text>
          ) : (
            <Skeleton width={100} height={16} />
          )}
        </View>
        <View flexDirection="row" gap={5} alignItems="center">
          {limit ? (
            <>
              <Text callout sensitive color="$uiBrandSecondary">
                {(limit - totalSpent).toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                  currencyDisplay: "narrowSymbol",
                  maximumFractionDigits: 0,
                })}
              </Text>
              <Text callout sensitive color="$uiBrandSecondary">
                left
              </Text>
            </>
          ) : (
            <Skeleton width={100} height={16} />
          )}
        </View>
      </XStack>
      <XStack flexDirection="row" flex={1} height={8} alignItems="center" justifyContent="space-between">
        <View width="100%" height={8} borderRadius="$r_0" backgroundColor="$backgroundBrandMild">
          {limit ? (
            <View
              width={`${(totalSpent / limit) * 100}%`}
              height={8}
              borderRadius="$r_0"
              backgroundColor="$uiBrandSecondary"
            />
          ) : null}
        </View>
      </XStack>
    </YStack>
  );
}
