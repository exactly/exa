import React from "react";
import { XStack, YStack } from "tamagui";

import Skeleton from "../shared/Skeleton";
import View from "../shared/View";

export default function HomeSkeleton() {
  return (
    <>
      <YStack backgroundColor="black" borderRadius="$r4" padding="$s4" gap="$s5">
        <Skeleton width="45%" height={14} radius={6} />
        <Skeleton width="70%" height={28} radius={10} />
        <Skeleton width="30%" height={12} radius={6} />
      </YStack>

      <YStack backgroundColor="$backgroundBrandSoft" borderRadius="$r3" padding="$s4" gap="$s4">
        <XStack justifyContent="space-between" alignItems="center">
          <YStack gap="$s2">
            <Skeleton width={140} height={16} radius={8} />
            <Skeleton width={200} height={12} radius={6} />
          </YStack>
          <Skeleton width={44} height={44} radius={16} />
        </XStack>
        <XStack gap="$s2" width="100%">
          {Array.from({ length: 3 }).map((_, index) => (
            <View key={`home-skeleton-brand-${index}`} flex={1}>
              <Skeleton width="100%" height={8} radius={4} />
            </View>
          ))}
        </XStack>
      </YStack>

      <YStack backgroundColor="$interactiveBaseBrandDefault" borderRadius="$r4" padding="$s4" gap="$s4">
        <Skeleton width="40%" height={16} radius={8} />
        <Skeleton width="60%" height={12} radius={6} />
        <Skeleton width="45%" height={12} radius={6} />
      </YStack>

      <YStack backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s5">
        <Skeleton width="35%" height={16} radius={8} />
        <YStack backgroundColor="black" borderRadius="$r4" padding="$s4" gap="$s5">
          <Skeleton width="45%" height={14} radius={6} />
          <Skeleton width="70%" height={28} radius={10} />
          <Skeleton width="30%" height={12} radius={6} />
        </YStack>
        {Array.from({ length: 2 }).map((_, index) => (
          <XStack key={`home-skeleton-actions-${index}`} justifyContent="space-between" alignItems="center">
            <YStack gap="$s2">
              <Skeleton width={120} height={14} radius={6} />
              <Skeleton width={80} height={10} radius={5} />
            </YStack>
            <Skeleton width={72} height={24} radius={12} />
          </XStack>
        ))}
      </YStack>

      <YStack backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s5">
        <Skeleton width="40%" height={16} radius={8} />
        {Array.from({ length: 3 }).map((_, index) => (
          <XStack key={`home-skeleton-payments-${index}`} justifyContent="space-between" alignItems="center">
            <YStack gap="$s2">
              <Skeleton width={140} height={14} radius={6} />
              <Skeleton width={90} height={10} radius={5} />
            </YStack>
            <Skeleton width={64} height={24} radius={12} />
          </XStack>
        ))}
        <Skeleton width="70%" height={10} radius={5} />
      </YStack>

      <YStack backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s4">
        <XStack justifyContent="space-between" alignItems="center">
          <Skeleton width="40%" height={16} radius={8} />
          <Skeleton width={64} height={20} radius={10} />
        </XStack>
        {Array.from({ length: 4 }).map((_, index) => (
          <YStack key={`home-skeleton-activity-${index}`} gap="$s2" paddingVertical="$s2">
            <Skeleton width="50%" height={12} radius={6} />
            <Skeleton width="80%" height={10} radius={5} />
          </YStack>
        ))}
      </YStack>

    </>
  );
}
