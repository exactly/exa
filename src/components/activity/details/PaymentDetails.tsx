import type { CreditActivity, DebitActivity, InstallmentsActivity } from "@exactly/server/api/activity";
import { CalendarClock, CircleHelp, CreditCard } from "@tamagui/lucide-icons";
import React from "react";
import { Pressable } from "react-native";
import { Separator, XStack, YStack } from "tamagui";

import { presentArticle } from "../../../utils/intercom";
import reportError from "../../../utils/reportError";
import Text from "../../shared/Text";

export default function PaymentDetails({ item }: { item: CreditActivity | DebitActivity | InstallmentsActivity }) {
  return (
    <YStack gap="$s4">
      <YStack gap="$s4">
        <XStack gap="$s3" alignItems="center">
          <Text emphasized headline>
            Payment details
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
            Mode
          </Text>
          <XStack alignItems="center" gap="$s2">
            <Text primary callout>
              {item.mode > 0 ? "Pay Later" : "Card"}
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
              Fixed rate APR
            </Text>
            <Text callout color="$uiNeutralPrimary">
              {Number(item.mode > 0 && (item as CreditActivity).borrow.rate).toLocaleString(undefined, {
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
              Installments
            </Text>
            <XStack alignItems="center">
              <Text emphasized callout color="$uiNeutralPrimary">
                {item.mode === 1 && `1x`}
                {item.mode > 1 && `${(item as InstallmentsActivity).borrow.installments.length}x`}
                &nbsp;
              </Text>
              <Text callout color="$uiNeutralPrimary">
                {item.mode === 1 && (item.usdAmount + item.borrow.fee).toFixed(2)}
                {item.mode > 1 &&
                  (
                    (item.usdAmount + (item as InstallmentsActivity).borrow.fee) /
                    (item as InstallmentsActivity).borrow.installments.length
                  ).toFixed(2)}
                &nbsp;USDC
              </Text>
            </XStack>
          </XStack>
        )}
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Total
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {item.mode === 0 &&
              `${Math.abs(Number(item.usdAmount)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`}
            {item.mode === 1 &&
              `${Math.abs(Number(item.usdAmount + item.borrow.fee)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`}
            {item.mode > 1 &&
              `${Math.abs(
                Number(
                  (item as InstallmentsActivity).borrow.installments.reduce(
                    (accumulator, installment) => accumulator + installment.fee,
                    item.usdAmount,
                  ),
                ),
              ).toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`}
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
}
