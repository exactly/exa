import shortenHex from "@exactly/common/shortenHex";
import type { CreditActivity, DebitActivity, InstallmentsActivity, PandaActivity } from "@exactly/server/api/activity";
import { Copy } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { format } from "date-fns";
import { setStringAsync } from "expo-clipboard";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { Separator, XStack, YStack } from "tamagui";

import reportError from "../../../utils/reportError";
import Text from "../../shared/Text";

export default function PurchaseDetails({
  item,
}: {
  item: CreditActivity | DebitActivity | InstallmentsActivity | PandaActivity;
}) {
  const toast = useToastController();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const refund = item.usdAmount < 0;
  return (
    <YStack gap="$s4">
      <YStack gap="$s4">
        <Text emphasized headline>
          {refund ? t("Refund details") : t("Purchase details")}
        </Text>
        <Separator height={1} borderColor="$borderNeutralSoft" />
      </YStack>
      <YStack gap="$s3_5">
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Amount")}
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {Math.abs(item.amount).toLocaleString(language, {
              maximumFractionDigits: 8,
              minimumFractionDigits: 0,
            })}
            &nbsp;{item.currency}
          </Text>
        </XStack>
        {!refund && (
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              {t("ID")}
            </Text>
            <Pressable
              onPress={() => {
                setStringAsync(item.id).catch(reportError);
                toast.show(t("Operation ID copied!"), {
                  native: true,
                  duration: 1000,
                  burntOptions: { haptic: "success" },
                });
              }}
              hitSlop={15}
            >
              <XStack gap="$s3">
                <Text callout color="$uiNeutralPrimary">
                  {shortenHex(item.id)}
                </Text>
                <Copy size={20} color="$uiNeutralPrimary" />
              </XStack>
            </Pressable>
          </XStack>
        )}
        {!refund && Math.abs(item.usdAmount) > 0 && (
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              {t("Exchange rate")}
            </Text>
            <Text callout color="$uiNeutralPrimary">
              1 USD&nbsp;=&nbsp;
              {(Math.abs(item.amount) / Math.abs(item.usdAmount)).toLocaleString(language, {
                maximumFractionDigits: 2,
              })}
              &nbsp;{item.currency}
            </Text>
          </XStack>
        )}
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Date")}
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {format(item.timestamp, "yyyy-MM-dd")}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Time")}
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {format(item.timestamp, "HH:mm:ss")}
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
}
