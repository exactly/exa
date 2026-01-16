import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { CalendarClock, CircleHelp, CreditCard } from "@tamagui/lucide-icons";
import { Separator, XStack, YStack } from "tamagui";

import { presentArticle } from "../../../utils/intercom";
import reportError from "../../../utils/reportError";
import Text from "../../shared/Text";

import type { CreditActivity, DebitActivity, InstallmentsActivity } from "@exactly/server/api/activity";

export default function PaymentDetails({ item }: { item: CreditActivity | DebitActivity | InstallmentsActivity }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <YStack gap="$s4">
      <YStack gap="$s4">
        <XStack gap="$s3" alignItems="center">
          <Text emphasized headline>
            {t("Payment details")}
          </Text>
          <Pressable
            onPress={() => {
              presentArticle("11498255").catch(reportError);
            }}
          >
            <CircleHelp size={18} color="$uiNeutralPrimary" />
          </Pressable>
        </XStack>
        <Separator height={1} borderColor="$borderNeutralSoft" />
      </YStack>
      <YStack gap="$s3_5">
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Mode")}
          </Text>
          <XStack alignItems="center" gap="$s2">
            <Text primary callout>
              {item.mode > 0 ? t("Pay Later") : t("Card")}
            </Text>
            {item.mode > 0 ? (
              <CalendarClock size={20} color="$uiBrandPrimary" />
            ) : (
              <CreditCard size={20} color="$uiBrandPrimary" />
            )}
          </XStack>
        </XStack>
        {item.mode > 0 && (
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              {t("Fixed rate APR")}
            </Text>
            <Text callout color="$uiNeutralPrimary">
              {(item as CreditActivity).borrow.rate.toLocaleString(language, {
                style: "percent",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          </XStack>
        )}
        {item.mode !== 0 && (
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              {t("Installments")}
            </Text>
            <XStack alignItems="center">
              <Text emphasized callout color="$uiNeutralPrimary">
                {item.mode === 1 && `1x`}
                {item.mode > 1 && `${(item as InstallmentsActivity).borrow.installments.length}x`}
                &nbsp;
              </Text>
              <Text callout color="$uiNeutralPrimary">
                {item.mode === 1 &&
                  (item.usdAmount + item.borrow.fee).toLocaleString(language, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                {item.mode > 1 &&
                  (
                    (item.usdAmount + (item as InstallmentsActivity).borrow.fee) /
                    (item as InstallmentsActivity).borrow.installments.length
                  ).toLocaleString(language, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                &nbsp;USDC
              </Text>
            </XStack>
          </XStack>
        )}
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Total")}
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {item.mode === 0 &&
              `${Math.abs(item.usdAmount).toLocaleString(language, { maximumFractionDigits: 2 })} USDC`}
            {item.mode === 1 &&
              `${Math.abs(item.usdAmount + item.borrow.fee).toLocaleString(language, { maximumFractionDigits: 2 })} USDC`}
            {item.mode > 1 &&
              `${Math.abs(
                (item as InstallmentsActivity).borrow.installments.reduce(
                  (accumulator, installment) => accumulator + installment.fee,
                  item.usdAmount,
                ),
              ).toLocaleString(language, { maximumFractionDigits: 2 })} USDC`}
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
}
