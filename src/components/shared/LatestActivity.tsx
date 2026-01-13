import { ChevronRight } from "@tamagui/lucide-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { XStack, YStack } from "tamagui";

import type { getActivity } from "../../utils/server";
import ActivityItem from "../activity/ActivityItem";
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
  const router = useRouter();
  return (
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" gap="$s4">
      <XStack alignItems="center" justifyContent="space-between" paddingHorizontal="$s4" paddingTop="$s4">
        <Text emphasized headline flex={1}>
          {title}
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
                View all
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
                No activity yet
              </Text>
              <Text textAlign="center" color="$uiNeutralSecondary" subHeadline>
                Your transactions will show up here once you get started. Add funds to begin!
              </Text>
            </YStack>
          ))}
        {activity?.slice(0, 4).map((item, index, items) => (
          <ActivityItem
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
