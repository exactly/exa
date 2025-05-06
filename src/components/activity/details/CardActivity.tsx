import type { CreditActivity, DebitActivity, InstallmentsActivity, PandaActivity } from "@exactly/server/api/activity";
import { ClockAlert, ShoppingCart } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
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
  const processing = item.type === "panda" && country === "US" && isProcessing(item.timestamp);
  return (
    <>
      <YStack gap="$s7" paddingBottom="$s9">
        <XStack justifyContent="center" alignItems="center">
          <Square borderRadius="$r4" backgroundColor="$backgroundStrong" size={80}>
            {processing ? (
              <ClockAlert size={48} color="$interactiveOnBaseWarningSoft" strokeWidth={2} />
            ) : item.merchant.icon ? (
              <Image source={{ uri: item.merchant.icon }} width={80} height={80} borderRadius="$r4" />
            ) : (
              <ShoppingCart size={48} color="$uiNeutralPrimary" strokeWidth={2} />
            )}
          </Square>
        </XStack>
        <YStack gap="$s4_5" justifyContent="center" alignItems="center">
          <Text body color={processing ? "$interactiveOnBaseWarningSoft" : "$uiNeutralPrimary"}>
            {processing ? "Processing..." : "Paid"}
            <Text emphasized primary body $platform-web={{ whiteSpace: "normal" }}>
              &nbsp;
              {item.merchant.name}
            </Text>
          </Text>
          <Text title primary color="$uiNeutralPrimary">
            {Number(item.usdAmount).toLocaleString(undefined, {
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
      {item.type === "panda" ? (
        item.operations.map((operation) => (
          <YStack key={operation.id} gap="$s7">
            <PurchaseDetails item={operation} />
            <PaymentDetails item={operation} />
            <TransactionDetails source={operation} />
          </YStack>
        ))
      ) : (
        <YStack gap="$s7">
          <PurchaseDetails item={item} />
          <PaymentDetails item={item} />
          <TransactionDetails />
        </YStack>
      )}
    </>
  );
}
