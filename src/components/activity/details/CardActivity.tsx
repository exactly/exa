import type { CreditActivity, DebitActivity, InstallmentsActivity, PandaActivity } from "@exactly/server/api/activity";
import { ClockAlert, Import, ShoppingCart } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { useTranslation } from "react-i18next";
import { Square, XStack, YStack } from "tamagui";

import PaymentDetails from "./PaymentDetails";
import PurchaseDetails from "./PurchaseDetails";
import TransactionDetails from "./TransactionDetails";
import isProcessing from "../../../utils/isProcessing";
import Image from "../../shared/Image";
import Text from "../../shared/Text";

export default function CardActivity({
  item,
}: {
  item: CreditActivity | DebitActivity | InstallmentsActivity | PandaActivity;
}) {
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  const processing = country === "US" && isProcessing(item.timestamp);
  const refund = item.usdAmount < 0;
  const { t } = useTranslation();
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
            {Math.abs(Number(item.usdAmount)).toLocaleString(undefined, {
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
            {item.operations.map((operation, index) => (
              <YStack key={index} gap="$s7">
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
