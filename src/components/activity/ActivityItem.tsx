import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleDollarSign,
  ClockAlert,
  Import,
  ShoppingCart,
} from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { router } from "expo-router";
import { getName, registerLocale, type LocaleData } from "i18n-iso-countries/index";
import React from "react";
import { titleCase } from "title-case";

import isProcessing from "../../utils/isProcessing";
import queryClient, { type ActivityItem as Item } from "../../utils/queryClient";
import Image from "../shared/Image";
import Text from "../shared/Text";
import View from "../shared/View";

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
    <View
      key={id}
      flexDirection="row"
      gap="$s4"
      alignItems="center"
      paddingHorizontal="$s4"
      paddingTop="$s3"
      paddingBottom={isLast ? "$s4" : "$s3"}
      onPress={handlePress}
    >
      <View
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
      </View>
      <View flex={1} gap="$s2">
        <View flexDirection="row" justifyContent="space-between" alignItems="center" gap="$s4">
          <View gap="$s2" flexShrink={1}>
            <Text subHeadline color="$uiNeutralPrimary" numberOfLines={1}>
              {(type === "card" || type === "panda") && item.merchant.name}
              {type === "received" && "Received"}
              {type === "sent" && "Sent"}
              {type === "repay" && "Debt payment"}
            </Text>
            <Text
              caption
              color={
                refund ? "$uiNeutralSecondary" : processing ? "$interactiveOnBaseWarningSoft" : "$uiNeutralSecondary"
              }
              numberOfLines={1}
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
              {type !== "card" && type !== "panda" && format(timestamp, "yyyy-MM-dd")}
            </Text>
          </View>
          <View gap="$s2">
            <View flexDirection="row" alignItems="center" justifyContent="flex-end">
              <Text sensitive fontSize={15} fontWeight="bold" textAlign="right">
                {Math.abs(usdAmount).toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Text>
            </View>
            {amount ? (
              <Text sensitive fontSize={12} color="$uiNeutralSecondary" textAlign="right">
                {Math.abs(amount).toLocaleString(undefined, {
                  maximumFractionDigits: 8,
                  minimumFractionDigits: 0,
                })}
                {currency && ` ${currency}`}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}
