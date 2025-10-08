import { ChevronRight } from "@tamagui/lucide-icons";
import { useNavigation } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { XStack, YStack } from "tamagui";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import type { getActivity } from "../../utils/server";
import ActivityItem from "../activity/ActivityItem";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function LatestActivity({
  activity,
  title = "Latest activity",
  emptyComponent,
  loading = false,
}: {
  activity?: Awaited<ReturnType<typeof getActivity>>;
  title?: string;
  emptyComponent?: React.ReactNode;
  loading?: boolean;
}) {
  const navigation = useNavigation<AppNavigationProperties>();
  return (
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" gap="$s4">
      <XStack alignItems="center" justifyContent="space-between" paddingHorizontal="$s4" paddingTop="$s4">
        <Text emphasized headline flex={1}>
          {title}
        </Text>
        {!loading && activity?.length ? (
          <Pressable
            hitSlop={15}
            onPress={() => {
              navigation.navigate("activity");
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
        {loading ? (
          Array.from({ length: 4 }).map((_, index, { length }) => (
            <ActivitySkeleton key={index} isLast={index === length - 1} />
          ))
        ) : !activity?.length &&
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
        {!loading
          ? activity
              ?.slice(0, 4)
              .map((item, index, items) => (
                <ActivityItem key={item.id} item={item} isLast={index === items.length - 1} />
              ))
          : null}
      </YStack>
    </View>
  );
}

function ActivitySkeleton({ isLast }: { isLast: boolean }) {
  return (
    <XStack
      gap="$s4"
      alignItems="center"
      paddingHorizontal="$s4"
      paddingTop="$s3"
      paddingBottom={isLast ? "$s4" : "$s3"}
    >
      <Skeleton height={40} width={40} />
      <YStack flex={1} gap="$s2">
        <XStack justifyContent="space-between" alignItems="center" gap="$s4">
          <YStack gap="$s2" flexShrink={1}>
            <Skeleton height={16} width="70%" />
            <Skeleton height={12} width="40%" />
          </YStack>
          <YStack gap="$s2" alignItems="flex-end">
            <Skeleton height={16} width={80} />
            <Skeleton height={12} width={60} />
          </YStack>
        </XStack>
      </YStack>
    </XStack>
  );
}
