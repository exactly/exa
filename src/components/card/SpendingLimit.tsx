import { Skeleton } from "moti/skeleton";
import React from "react";
import { XStack, YStack } from "tamagui";

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
  const percent =
    limit !== undefined && Number.isFinite(limit) && limit > 0
      ? Math.max(0, Math.min(100, (totalSpent / limit) * 100))
      : undefined;
  return (
    <YStack justifyContent="flex-start" paddingHorizontal="$s3">
      <XStack flex={1} height={46} alignItems="center" justifyContent="space-between">
        <XStack gap={5} alignItems="center">
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
        </XStack>
        <XStack gap={5} alignItems="center">
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
        </XStack>
      </XStack>
      <XStack flex={1} height="$s3" alignItems="center" justifyContent="space-between">
        <XStack width="100%" height="$s3" borderRadius="$r_0" backgroundColor="$backgroundBrandMild">
          {percent === undefined ? null : (
            <XStack width={`${percent}%`} height="$s3" borderRadius="$r_0" backgroundColor="$uiBrandSecondary" />
          )}
        </XStack>
      </XStack>
    </YStack>
  );
}
