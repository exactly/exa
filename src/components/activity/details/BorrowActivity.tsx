import type { BorrowActivity as BorrowActivityType } from "@exactly/server/api/activity";
import { HandCoins } from "@tamagui/lucide-icons";
import React from "react";
import { Square, XStack, YStack } from "tamagui";

import BorrowDetails from "./BorrowDetails";
import TransactionDetails from "./TransactionDetails";
import assetLogos from "../../../utils/assetLogos";
import AssetLogo from "../../shared/AssetLogo";
import Text from "../../shared/Text";

export default function BorrowActivity({ item }: { item: Omit<BorrowActivityType, "blockNumber"> }) {
  const { amount, usdAmount, currency } = item;
  return (
    <>
      <YStack gap="$s7" paddingBottom="$s9">
        <XStack justifyContent="center" alignItems="center">
          <Square borderRadius="$r4" backgroundColor="$backgroundStrong" size={80}>
            <HandCoins size="$iconSize.xxl" color="$uiNeutralPrimary" strokeWidth="$iconStroke.xxl" />
          </Square>
        </XStack>
        <YStack gap="$s4_5" justifyContent="center" alignItems="center">
          <Text primary body emphasized textAlign="center">
            Loan taken
          </Text>
          <Text title primary>
            {Number(usdAmount).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
          </Text>
          <XStack gap="$s3" alignItems="center">
            <AssetLogo uri={assetLogos[currency as keyof typeof assetLogos]} width={16} height={16} />
            <Text emphasized subHeadline color="$uiNeutralSecondary">
              {Number(amount).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: currency === "USDC" ? 2 : 8,
              })}
            </Text>
          </XStack>
        </YStack>
      </YStack>
      <YStack flex={1} gap="$s7">
        <BorrowDetails item={item} />
        <TransactionDetails />
      </YStack>
    </>
  );
}
