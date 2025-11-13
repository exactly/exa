import React from "react";
import { XStack, YStack } from "tamagui";

import Skeleton from "../shared/Skeleton";

export default function HomePortfolioSkeleton() {
  return (
    <YStack gap="$s4">
      <Skeleton width="60%" height={14} radius={6} />
      <YStack gap="$s6" alignItems="center">
        <Skeleton width="30%" height={16} radius={6} />
        <Skeleton width="80%" height={42} radius={20} />
        <Skeleton width="65%" height={20} radius={10} />
      </YStack>
      <XStack gap="$s4" width="100%">
        <Skeleton width="48%" height={52} radius={16} />
        <Skeleton width="48%" height={52} radius={16} />
      </XStack>
    </YStack>
  );
}
