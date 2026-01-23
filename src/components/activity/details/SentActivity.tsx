import React from "react";
import { useTranslation } from "react-i18next";

import { ArrowUpFromLine } from "@tamagui/lucide-icons";
import { Square, XStack, YStack } from "tamagui";

import shortenHex from "@exactly/common/shortenHex";

import TransactionDetails from "./TransactionDetails";
import AssetLogo from "../../shared/AssetLogo";
import Text from "../../shared/Text";

import type { WithdrawActivity } from "@exactly/server/api/activity";

export default function SentActivity({ item }: { item: Omit<WithdrawActivity, "blockNumber"> }) {
  const { amount, usdAmount, currency } = item;
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <>
      <YStack gap="$s7" paddingBottom="$s9">
        <XStack justifyContent="center" alignItems="center">
          <Square borderRadius="$r4" backgroundColor="$backgroundStrong" size={80}>
            <ArrowUpFromLine size={48} color="$interactiveOnBaseErrorSoft" strokeWidth={2} />
          </Square>
        </XStack>
        <YStack gap="$s4_5" justifyContent="center" alignItems="center">
          <Text secondary body>
            {t("Sent to")}
            <Text emphasized primary body>
              &nbsp;
              {shortenHex(item.receiver)}
            </Text>
          </Text>
          <Text title primary color="$uiErrorSecondary">
            {`$${usdAmount.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </Text>
          <XStack gap="$s3" alignItems="center">
            <Text emphasized subHeadline color="$uiNeutralSecondary">
              {amount.toLocaleString(language, { maximumFractionDigits: 8, minimumFractionDigits: 0 })}
              &nbsp;
              {currency}
            </Text>
            <AssetLogo symbol={currency} width={16} height={16} />
          </XStack>
        </YStack>
      </YStack>
      <YStack flex={1} gap="$s7">
        <TransactionDetails />
      </YStack>
    </>
  );
}
