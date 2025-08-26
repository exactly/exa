import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleDollarSign,
  ClockAlert,
  Import,
  ShoppingCart,
  SquareDashed,
} from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useNavigation } from "expo-router";
import { getName, registerLocale, type LocaleData } from "i18n-iso-countries/index";
import React from "react";
import { XStack, YStack } from "tamagui";
import { titleCase } from "title-case";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import isProcessing from "../../utils/isProcessing";
import queryClient, { type ActivityItem as Item } from "../../utils/queryClient";
import Image from "../shared/Image";
import Text from "../shared/Text";

registerLocale(require("i18n-iso-countries/langs/en.json") as LocaleData); // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module

export default function ActivityItem({ item, isLast }: { item: Item; isLast: boolean }) {
  const navigation = useNavigation<AppNavigationProperties>();
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  const processing = item.type === "panda" && country === "US" && isProcessing(item.timestamp);
  const refund = item.type === "panda" && item.usdAmount < 0;
  return (
    <XStack
      key={item.id}
      gap="$s4"
      alignItems="center"
      paddingHorizontal="$s4"
      paddingTop="$s3"
      paddingBottom={isLast ? "$s4" : "$s3"}
      cursor="pointer"
      onPress={() => {
        if (["card", "received", "sent", "repay", "panda"].includes(item.type)) {
          queryClient.setQueryData(["activity", "details"], item);
          navigation.navigate("activity-details");
        }
      }}
    >
      <YStack
        width={40}
        height={40}
        backgroundColor="$backgroundStrong"
        borderRadius="$r3"
        justifyContent="center"
        alignItems="center"
      >
        {getActivityIcon(item, processing, refund)}
      </YStack>
      <YStack flex={1} gap="$s2">
        <XStack justifyContent="space-between" alignItems="center" gap="$s4">
          <YStack gap="$s2" flexShrink={1}>
            <Text primary subHeadline numberOfLines={1}>
              {getActivityTitle(item)}
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
                  : (item.type === "card" || item.type === "panda") &&
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
              {item.type !== "card" &&
                item.type !== "panda" &&
                "timestamp" in item &&
                format(item.timestamp, "yyyy-MM-dd")}
            </Text>
          </YStack>
          {"usdAmount" in item ? (
            <YStack gap="$s2">
              <XStack alignItems="center" justifyContent="flex-end">
                <Text sensitive emphasized subHeadline textAlign="right">
                  {Math.abs(item.usdAmount).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </XStack>
              {"amount" in item && item.amount ? (
                <Text sensitive secondary caption textAlign="right">
                  {`${"currency" in item && item.currency ? item.currency : ""} ${Math.abs(item.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: "currency" in item && item.currency === "USDC" ? 2 : 8 })}`}
                </Text>
              ) : null}
            </YStack>
          ) : null}
        </XStack>
      </YStack>
    </XStack>
  );
}

function getActivityIcon(item: Item, processing: boolean, refund: boolean) {
  switch (item.type) {
    case "card":
      return <ShoppingCart color="$uiNeutralPrimary" />;
    case "received":
      return <ArrowDownToLine color="$interactiveOnBaseSuccessSoft" />;
    case "sent":
      return <ArrowUpFromLine color="$interactiveOnBaseErrorSoft" />;
    case "repay":
      return <CircleDollarSign color="$interactiveOnBaseErrorSoft" />;
    case "panda":
      if (refund) return <Import color="$uiSuccessSecondary" />;
      if (processing) return <ClockAlert color="$interactiveOnBaseWarningSoft" />;
      if (item.merchant.icon)
        return <Image source={{ uri: item.merchant.icon }} minWidth={40} minHeight={40} borderRadius="$r3" />;
      return <ShoppingCart color="$uiNeutralPrimary" />;
    default:
      return <SquareDashed color="$uiNeutralPrimary" />;
  }
}

function getActivityTitle(item: Item) {
  let title;
  switch (item.type) {
    case "card":
    case "panda":
      title = item.merchant.name;
      break;
    case "received":
      title = "Received";
      break;
    case "sent":
      title = "Sent";
      break;
    case "repay":
      title = "Debt payment";
      break;
    default:
      title = undefined;
  }
  title ??= "type" in item ? item.type.charAt(0).toUpperCase() + item.type.slice(1) : "Unknown";
  return title;
}
