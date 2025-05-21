import type { RolloverActivity as RolloverActivityType } from "@exactly/server/api/activity";
import { RefreshCw } from "@tamagui/lucide-icons";
import React from "react";
import { Square, XStack, YStack } from "tamagui";

import RolloverDetails from "./RolloverDetails";
import TransactionDetails from "./TransactionDetails";
import assetLogos from "../../../utils/assetLogos";
import AssetLogo from "../../shared/AssetLogo";
import Text from "../../shared/Text";

export default function RolloverActivity({ item }: { item: Omit<RolloverActivityType, "blockNumber"> }) {
  const { amount, usdAmount, currency } = item;
  return (
    <>
      <YStack gap="$s7" paddingBottom="$s9">
        <XStack justifyContent="center" alignItems="center">
          <Square borderRadius="$r4" backgroundColor="$backgroundStrong" size={80}>
            <RefreshCw size={48} color="$uiNeutralSecondary" strokeWidth={2} />
          </Square>
        </XStack>
        <YStack gap="$s4_5" justifyContent="center" alignItems="center">
          <Text primary body emphasized textAlign="center">
            Debt rollover
          </Text>
          <Text title primary color="$uiNeutralSecondary">
            {Number(usdAmount).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
          </Text>
          <XStack gap="$s3" alignItems="center">
            <AssetLogo uri={assetLogos[currency as keyof typeof assetLogos]} width={16} height={16} />
            <Text emphasized subHeadline color="$uiNeutralSecondary">
              {Number(amount).toLocaleString(undefined, { maximumFractionDigits: 8, minimumFractionDigits: 0 })}
            </Text>
          </XStack>
        </YStack>
      </YStack>
      <YStack flex={1} gap="$s7">
        <RolloverDetails item={item} />
        <TransactionDetails />
      </YStack>
    </>
  );
}
