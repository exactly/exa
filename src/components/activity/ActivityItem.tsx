import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleDollarSign,
  ClockAlert,
  HandCoins,
  Import,
  ShoppingCart,
} from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { router } from "expo-router";
import { getName, registerLocale, type LocaleData } from "i18n-iso-countries/index";
import React from "react";
import { XStack, YStack } from "tamagui";
import { titleCase } from "title-case";

import isProcessing from "../../utils/isProcessing";
import queryClient, { type ActivityItem as Item } from "../../utils/queryClient";
import Image from "../shared/Image";
import Text from "../shared/Text";

registerLocale(require("i18n-iso-countries/langs/en.json") as LocaleData); // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module

export default function ActivityItem({ item, isLast }: { item: Item; isLast: boolean }) {
  const { amount, id, usdAmount, currency, type, timestamp } = item;
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  function handlePress() {
    queryClient.setQueryData(["activity", "details"], item);
    router.push({ pathname: "/activity-details" });
  }
  const processing = type === "panda" && country === "US" && isProcessing(item.timestamp);
  const refund = type === "panda" && usdAmount < 0;
  return (
    <XStack
      key={id}
      gap="$s4"
      alignItems="center"
      paddingHorizontal="$s4"
      paddingTop="$s3"
      paddingBottom={isLast ? "$s4" : "$s3"}
      cursor="pointer"
      onPress={handlePress}
    >
      <YStack
        width={40}
        height={40}
        backgroundColor="$backgroundStrong"
        borderRadius="$r3"
        justifyContent="center"
        alignItems="center"
      >
        {type === "card" && <ShoppingCart color="$uiNeutralPrimary" />}
        {type === "received" && <ArrowDownToLine color="$interactiveOnBaseSuccessSoft" />}
        {type === "sent" && <ArrowUpFromLine color="$interactiveOnBaseErrorSoft" />}
        {type === "repay" && <CircleDollarSign color="$interactiveOnBaseErrorSoft" />}
        {type === "borrow" && <HandCoins color="$uiNeutralPrimary" />}
        {type === "panda" &&
          (refund ? (
            <Import color="$uiSuccessSecondary" />
          ) : processing ? (
            <ClockAlert color="$interactiveOnBaseWarningSoft" />
          ) : item.merchant.icon ? (
            <Image source={{ uri: item.merchant.icon }} width={40} height={40} borderRadius="$r3" />
          ) : (
            <ShoppingCart color="$uiNeutralPrimary" />
          ))}
      </YStack>
      <YStack flex={1} gap="$s2">
        <XStack justifyContent="space-between" alignItems="center" gap="$s4">
          <YStack gap="$s2" flexShrink={1}>
            <Text primary subHeadline numberOfLines={1}>
              {(type === "card" || type === "panda") && item.merchant.name}
              {type === "received" && "Received"}
              {type === "sent" && "Sent"}
              {type === "repay" && "Debt payment"}
              {type === "borrow" && "Loan taken"}
            </Text>
            <Text
              secondary
              caption
              numberOfLines={1}
              color={processing ? "$interactiveOnBaseWarningSoft" : "$uiNeutralSecondary"}
            >
              {refund
                ? "Refund"
                : processing
                  ? "Processing..."
                  : (type === "card" || type === "panda") &&
                    titleCase(
                      [
                        item.merchant.city,
                        item.merchant.state,
                        item.merchant.country && getName(item.merchant.country, "en"),
                      ]
                        .filter((field) => field && field !== "null")
                        .join(", ")
                        .toLowerCase(),
                    )}
              {type === "borrow" && `Due ${format(item.maturity * 1000, "yyyy-MM-dd")}`}
              {type !== "card" && type !== "panda" && type !== "borrow" && format(timestamp, "yyyy-MM-dd")}
            </Text>
          </YStack>
          <YStack gap="$s2">
            <XStack alignItems="center" justifyContent="flex-end">
              <Text sensitive emphasized subHeadline textAlign="right">
                {Math.abs(usdAmount).toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Text>
            </XStack>
            {amount ? (
              <Text sensitive secondary caption textAlign="right">
                {`${currency && currency} ${Math.abs(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: currency === "USDC" ? 2 : 8 })}`}
              </Text>
            ) : null}
          </YStack>
        </XStack>
      </YStack>
    </XStack>
  );
}
