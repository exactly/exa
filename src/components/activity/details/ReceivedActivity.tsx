import type { DepositActivity } from "@exactly/server/api/activity";
import { ArrowDownToLine } from "@tamagui/lucide-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Square, XStack, YStack } from "tamagui";

import TransactionDetails from "./TransactionDetails";
import assetLogos from "../../../utils/assetLogos";
import AssetLogo from "../../shared/AssetLogo";
import Text from "../../shared/Text";

// TODO review prop type
export default function ReceivedActivity({ item }: { item: Omit<DepositActivity, "blockNumber"> }) {
  const { amount, usdAmount, currency } = item;
  const { t } = useTranslation();
  return (
    <>
      <YStack gap="$s7" paddingBottom="$s9">
        <XStack justifyContent="center" alignItems="center">
          <Square borderRadius="$r4" backgroundColor="$backgroundStrong" size={80}>
            <ArrowDownToLine size={48} color="$interactiveOnBaseSuccessSoft" strokeWidth={2} />
          </Square>
        </XStack>
        <YStack gap="$s4_5" justifyContent="center" alignItems="center">
          <Text secondary body>
            {t("Received")}
          </Text>
          <Text title primary color="$uiSuccessSecondary">
            {Number(usdAmount).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
          </Text>
          <XStack gap="$s3" alignItems="center">
            <Text emphasized subHeadline color="$uiNeutralSecondary">
              {Number(amount).toLocaleString(undefined, { maximumFractionDigits: 8, minimumFractionDigits: 0 })}
              &nbsp;
              {currency}
            </Text>
            <AssetLogo source={{ uri: assetLogos[currency as keyof typeof assetLogos] }} width={16} height={16} />
          </XStack>
        </YStack>
      </YStack>
      <YStack flex={1} gap="$s7">
        <TransactionDetails />
      </YStack>
    </>
  );
}
