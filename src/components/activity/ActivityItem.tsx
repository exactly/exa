import React from "react";
import { useTranslation } from "react-i18next";

import { router } from "expo-router";

import { Square, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { getName, registerLocale } from "i18n-iso-countries/index";
import en from "i18n-iso-countries/langs/en.json";
import es from "i18n-iso-countries/langs/es.json";
import pt from "i18n-iso-countries/langs/pt.json";
import { titleCase } from "title-case";

import chain from "@exactly/common/generated/chain";

import { ArrowDownToLine } from "../../generated/icons/ArrowDownToLine";
import { ArrowLeftRight } from "../../generated/icons/ArrowLeftRight";
import { ArrowUpFromLine } from "../../generated/icons/ArrowUpFromLine";
import { ArrowUpRight } from "../../generated/icons/ArrowUpRight";
import { CircleDollarSign } from "../../generated/icons/CircleDollarSign";
import { ClockAlert } from "../../generated/icons/ClockAlert";
import { HandCoins } from "../../generated/icons/HandCoins";
import { Import } from "../../generated/icons/Import";
import { RefreshCw } from "../../generated/icons/RefreshCw";
import { ShoppingCart } from "../../generated/icons/ShoppingCart";
import { SquareDashed } from "../../generated/icons/SquareDashed";
import { TriangleAlert } from "../../generated/icons/TriangleAlert";
import isProcessing from "../../utils/isProcessing";
import Image from "../shared/Image";
import Text from "../shared/Text";

import type { ActivityItem as Item } from "../../utils/queryClient";
import type { TFunction } from "i18next";

registerLocale(en);
registerLocale(es);
registerLocale(pt);

export default function ActivityItem({
  item,
  height,
  isLast,
  stackProps,
}: {
  height?: number;
  isLast: boolean;
  item: Item;
  stackProps?: React.ComponentProps<typeof XStack>;
}) {
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  const declined = item.type === "panda" && item.status === "declined";
  const processing = item.type === "panda" && !declined && country === "US" && isProcessing(item.timestamp);
  const refund = item.type === "panda" && item.usdAmount < 0;
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <XStack
      height={height}
      gap="s4"
      alignItems="center"
      paddingHorizontal="s4"
      paddingTop="s3"
      paddingBottom={isLast ? "s4" : "s3"}
      cursor="pointer"
      onPress={() => {
        router.push({ pathname: "/activity-details", params: { id: item.id } });
      }}
      backgroundColor="backgroundMild"
      {...stackProps}
    >
      <YStack
        width="s7"
        height="s7"
        backgroundColor="backgroundStrong"
        borderRadius="r3"
        justifyContent="center"
        alignItems="center"
      >
        {getActivityIcon(item, processing, refund)}
      </YStack>
      <YStack flex={1} gap="s2">
        <XStack justifyContent="space-between" alignItems="center" gap="s4">
          <YStack gap="s2" flexShrink={1}>
            <Text primary subHeadline numberOfLines={1}>
              {getActivityTitle(item, t)}
            </Text>
            <Text
              secondary
              caption
              numberOfLines={1}
              color={processing ? "interactiveOnBaseWarningSoft" : declined ? "uiErrorSecondary" : "uiNeutralSecondary"}
            >
              {declined
                ? t("Payment failed")
                : refund
                  ? t("Refund")
                  : processing
                    ? t("Processing...")
                    : (item.type === "card" || item.type === "panda") &&
                      titleCase(
                        [
                          item.merchant.city,
                          item.merchant.state,
                          item.merchant.country && getName(item.merchant.country, language.split("-")[0] ?? "en"),
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
          {"usdAmount" in item || "amount" in item ? (
            <YStack gap="s2">
              {"usdAmount" in item && item.usdAmount !== undefined && (
                <XStack alignItems="center" justifyContent="flex-end">
                  <Text
                    sensitive
                    emphasized
                    subHeadline
                    textAlign="right"
                    strikeThrough={declined}
                    color="uiNeutralPrimary"
                  >
                    {`$${Math.abs(item.usdAmount).toLocaleString(language, {
                      style: "decimal",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`}
                  </Text>
                </XStack>
              )}
              {"amount" in item && item.amount ? (
                <Text sensitive secondary caption textAlign="right">
                  {`${"currency" in item && item.currency ? item.currency : ""} ${Math.abs(item.amount).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: "currency" in item && item.currency === "USDC" ? 2 : 8 })}`}
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
      return <ShoppingCart color="uiNeutralPrimary" />;
    case "received":
      return <ArrowDownToLine color="interactiveOnBaseSuccessSoft" />;
    case "sent":
      return <ArrowUpFromLine color="interactiveOnBaseErrorSoft" />;
    case "repay":
      return <CircleDollarSign color="interactiveOnBaseErrorSoft" />;
    case "loan":
      return <HandCoins color="interactiveOnBaseSuccessSoft" />;
    case "rollover":
      return <RefreshCw color="uiNeutralPrimary" />;
    case "swap":
      return <ArrowLeftRight color="uiNeutralPrimary" />;
    case "liquidation":
      return <TriangleAlert color="interactiveOnBaseErrorSoft" />;
    case "bridge":
      if (item.destinationChainId === chain.id) return <ArrowDownToLine color="interactiveOnBaseSuccessSoft" />;
      return <ArrowUpRight color="interactiveOnBaseErrorSoft" />;
    case "panda":
      if (refund) return <Import color="uiSuccessSecondary" />;
      if (processing) return <ClockAlert color="interactiveOnBaseWarningSoft" />;
      if (item.merchant.icon)
        return (
          <Square size="s7" borderRadius="r3" backgroundColor="white">
            <Image source={{ uri: item.merchant.icon }} width={26} height={26} contentFit="contain" />
          </Square>
        );
      return <ShoppingCart color="uiNeutralPrimary" />;
    default:
      return <SquareDashed color="uiNeutralPrimary" />;
  }
}

function getActivityTitle(item: Item, t: TFunction) {
  let title;
  switch (item.type) {
    case "card":
    case "panda":
      title = item.merchant.name;
      break;
    case "received":
      title = t("Received");
      break;
    case "sent":
      title = t("Sent");
      break;
    case "repay":
      title = t("Debt payment");
      break;
    case "loan":
      title = t("Loan");
      break;
    case "rollover":
      title = t("Debt rollover");
      break;
    case "swap":
      title = t("Swapped {{from}} for {{to}}", { from: item.from.currency, to: item.currency });
      break;
    case "liquidation":
      title = t("Liquidation");
      break;
    case "bridge":
      title = item.destinationChainId === chain.id ? t("Received from another network") : t("Sent to another network");
      break;
    default:
      title = undefined;
  }
  title ??= t("Unknown");
  return title;
}
