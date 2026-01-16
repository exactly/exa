import React from "react";
import { useTranslation } from "react-i18next";

import { ClockAlert, Import, ShoppingCart } from "@tamagui/lucide-icons";
import { Square, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import PaymentDetails from "./PaymentDetails";
import PurchaseDetails from "./PurchaseDetails";
import TransactionDetails from "./TransactionDetails";
import isProcessing from "../../../utils/isProcessing";
import Image from "../../shared/Image";
import Text from "../../shared/Text";

import type { CreditActivity, DebitActivity, InstallmentsActivity, PandaActivity } from "@exactly/server/api/activity";

export default function CardActivity({
  item,
}: {
  item: CreditActivity | DebitActivity | InstallmentsActivity | PandaActivity;
}) {
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const processing = country === "US" && isProcessing(item.timestamp);
  const refund = item.usdAmount < 0;
  return (
    <>
      <YStack gap="$s7" paddingBottom="$s9">
        <XStack justifyContent="center" alignItems="center">
          <Square borderRadius="$r4" backgroundColor="$backgroundStrong" size={80}>
            {refund ? (
              <Import size={48} color="$uiSuccessSecondary" strokeWidth={2} />
            ) : processing ? (
              <ClockAlert size={48} color="$interactiveOnBaseWarningSoft" strokeWidth={2} />
            ) : item.merchant.icon ? (
              <Image source={{ uri: item.merchant.icon }} width={80} height={80} borderRadius="$r4" />
            ) : (
              <ShoppingCart size={48} color="$uiNeutralPrimary" strokeWidth={2} />
            )}
          </Square>
        </XStack>
        <YStack gap="$s4_5" justifyContent="center" alignItems="center">
          <Text
            body
            color={refund ? "$uiNeutralSecondary" : processing ? "$interactiveOnBaseWarningSoft" : "$uiNeutralPrimary"}
          >
            {refund ? t("Refund") : processing ? t("Processing...") : t("Paid")}
            <Text emphasized primary body $platform-web={{ whiteSpace: "normal" }}>
              &nbsp;
              {item.merchant.name}
            </Text>
          </Text>
          <Text title primary color={refund ? "$uiSuccessSecondary" : "$uiNeutralPrimary"}>
            {Math.abs(item.usdAmount).toLocaleString(language, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
          </Text>
          <Text secondary body>
            {item.merchant.name}
          </Text>
        </YStack>
      </YStack>
      <YStack gap="$s7">
        {item.type === "panda" ? (
          <>
            {item.operations.map((operation) => (
              <YStack key={operation.id} gap="$s7">
                <PurchaseDetails item={operation} />
                {item.usdAmount > 0 && <PaymentDetails item={operation} />}
              </YStack>
            ))}
            <TransactionDetails source={item.operations[0]} />
          </>
        ) : (
          <>
            <PurchaseDetails item={item} />
            <PaymentDetails item={item} />
            <TransactionDetails />
          </>
        )}
      </YStack>
    </>
  );
}
