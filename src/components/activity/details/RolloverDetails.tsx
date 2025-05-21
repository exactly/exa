import type { RolloverActivity } from "@exactly/server/api/activity";
import { format } from "date-fns";
import React from "react";
import { Separator, XStack, YStack } from "tamagui";

import assetLogos from "../../../utils/assetLogos";
import AssetLogo from "../../shared/AssetLogo";
import Text from "../../shared/Text";

export default function RolloverDetails({ item }: { item: Omit<RolloverActivity, "blockNumber"> }) {
  const { repay, borrow } = item;
  return (
    <YStack gap="$s4">
      <YStack gap="$s4">
        <Text emphasized headline>
          Rollover details
        </Text>
        <Separator height={1} borderColor="$borderNeutralSoft" />
      </YStack>
      <YStack gap="$s3_5">
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Amount
          </Text>
          <XStack alignItems="center" gap="$s3">
            <AssetLogo uri={assetLogos[repay.currency as keyof typeof assetLogos]} width={16} height={16} />
            <Text callout>
              {Number(repay.amount).toLocaleString(undefined, {
                maximumFractionDigits: 8,
                minimumFractionDigits: 0,
              })}
            </Text>
          </XStack>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Rollover from
          </Text>
          <XStack alignItems="center" gap="$s3">
            <Text callout>{format(repay.maturity * 1000, "yyyy-MM-dd")}</Text>
          </XStack>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Rollover to
          </Text>
          <XStack alignItems="center" gap="$s3">
            <Text callout>{format(borrow.maturity * 1000, "yyyy-MM-dd")}</Text>
          </XStack>
        </XStack>
      </YStack>
    </YStack>
  );
}
