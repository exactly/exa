import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ChevronRight } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import ActivityItemView from "../activity/ActivityItem";
import Text from "../shared/Text";
import View from "../shared/View";

import type { ActivityItem } from "../../utils/queryClient";

export default function LatestActivity({
  activity,
  title,
  emptyComponent,
}: {
  activity?: ActivityItem[];
  emptyComponent?: React.ReactNode;
  title?: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" gap="$s4">
      <XStack alignItems="center" justifyContent="space-between" paddingHorizontal="$s4" paddingTop="$s4">
        <Text emphasized headline flex={1}>
          {title ?? t("Latest activity")}
        </Text>
        {activity?.length ? (
          <Pressable
            hitSlop={15}
            onPress={() => {
              router.push("/activity");
            }}
          >
            <XStack gap="$s1" alignItems="center">
              <Text color="$interactiveTextBrandDefault" emphasized footnote fontWeight="bold">
                {t("View all")}
              </Text>
              <ChevronRight size={14} color="$interactiveTextBrandDefault" strokeWidth={2.5} />
            </XStack>
          </Pressable>
        ) : null}
      </XStack>
      <YStack>
        {!activity?.length &&
          (emptyComponent ?? (
            <YStack alignItems="center" justifyContent="center" gap="$s4_5" padding="$s4" paddingTop={0}>
              <Text textAlign="center" color="$uiNeutralSecondary" emphasized title>
                📋
              </Text>
              <Text textAlign="center" color="$uiBrandSecondary" emphasized headline>
                {t("No activity yet")}
              </Text>
              <Text textAlign="center" color="$uiNeutralSecondary" subHeadline>
                {t("Your transactions will show up here once you get started. Add funds to begin!")}
              </Text>
            </YStack>
          ))}
        {activity?.slice(0, 4).map((item, index, items) => (
          <ActivityItemView
            key={item.id}
            item={item}
            isLast={index === items.length - 1}
            stackProps={{ backgroundColor: "transparent" }}
          />
        ))}
      </YStack>
    </View>
  );
}
