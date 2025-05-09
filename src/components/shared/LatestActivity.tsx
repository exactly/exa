import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  CircleDollarSign,
  ClockAlert,
  Import,
  ShoppingCart,
} from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { router } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { YStack } from "tamagui";

import isProcessing from "../../utils/isProcessing";
import queryClient from "../../utils/queryClient";
import type { getActivity } from "../../utils/server";
import InfoCard from "../home/InfoCard";
import Image from "../shared/Image";
import Text from "../shared/Text";
import View from "../shared/View";

export default function LatestActivity({
  activity,
  title = "Latest activity",
  emptyComponent,
}: {
  activity?: Awaited<ReturnType<typeof getActivity>>;
  title?: string;
  emptyComponent?: React.ReactNode;
}) {
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  return (
    <InfoCard
      title={title}
      renderAction={
        activity?.length ? (
          <Pressable
            hitSlop={15}
            onPress={() => {
              router.push("/activity");
            }}
          >
            <View flexDirection="row" gap="$s1" alignItems="center">
              <Text color="$interactiveTextBrandDefault" emphasized footnote fontWeight="bold">
                View all
              </Text>
              <ChevronRight size={14} color="$interactiveTextBrandDefault" fontWeight="bold" />
            </View>
          </Pressable>
        ) : null
      }
    >
      {!activity?.length &&
        (emptyComponent ?? (
          <YStack alignItems="center" justifyContent="center" gap="$s4_5">
            <Text textAlign="center" color="$uiNeutralSecondary" emphasized title>
              📋
            </Text>
            <Text textAlign="center" color="$uiBrandSecondary" emphasized headline>
              No activity yet
            </Text>
            <Text textAlign="center" color="$uiNeutralSecondary" subHeadline>
              Your transactions will show up here once you get started. Add funds to begin!
            </Text>
          </YStack>
        ))}
      {activity?.slice(0, 4).map((item) => {
        const { amount, id, usdAmount, currency, type, timestamp } = item;
        const processing = type === "panda" && country === "US" && isProcessing(item.timestamp);
        const refund = type === "panda" && usdAmount < 0;
        return (
          <View
            key={id}
            flexDirection="row"
            gap="$s4"
            alignItems="center"
            onPress={() => {
              queryClient.setQueryData(["activity", "details"], item);
              router.push({ pathname: "/activity-details" });
            }}
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
                    {type === "card" && item.merchant.name}
                    {type === "received" && "Received"}
                    {type === "sent" && "Sent"}
                    {type === "repay" && "Debt payment"}
                    {type === "panda" && item.merchant.name}
                  </Text>
                  <Text
                    caption
                    color={
                      refund
                        ? "$uiNeutralSecondary"
                        : processing
                          ? "$interactiveOnBaseWarningSoft"
                          : "$uiNeutralSecondary"
                    }
                    numberOfLines={1}
                  >
                    {refund ? "Refund" : processing ? "Processing..." : format(timestamp, "yyyy-MM-dd")}
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
                  <Text sensitive fontSize={12} color="$uiNeutralSecondary" textAlign="right">
                    {Math.abs(Number(amount ?? 0)).toLocaleString(undefined, {
                      maximumFractionDigits: 8,
                      minimumFractionDigits: 0,
                    })}
                    {currency && ` ${currency}`}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        );
      })}
    </InfoCard>
  );
}
