import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import { XStack, YStack } from "tamagui";

import CardLimits from "./CardLimits";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import Card from "../../assets/images/card.svg";
import type { CardDetails } from "../../utils/card";
import Skeleton from "../shared/Skeleton";
import View from "../shared/View";

export default function CardStatus({ onInfoPress }: { onInfoPress: () => void }) {
  const navigation = useNavigation<AppNavigationProperties>();
  const { data: card, isPending } = useQuery<CardDetails>({ queryKey: ["card", "details"] });
  if (isPending) return <CardStatusSkeleton />;
  if (!card) return null;
  return (
    <XStack
      backgroundColor="black"
      borderRadius="$r4"
      alignItems="center"
      overflow="hidden"
      height={136}
      justifyContent="space-between"
      padding="$s4"
    >
      <YStack height="100%" justifyContent="space-between" alignItems="flex-start" zIndex={2}>
        <CardLimits onPress={onInfoPress} />
      </YStack>
      <XStack
        position="absolute"
        right={0}
        left={0}
        top={0}
        bottom={0}
        justifyContent="flex-end"
        cursor="pointer"
        onPress={() => {
          navigation.navigate("(home)", { screen: "card" });
        }}
      >
        <Card
          width="100%"
          height="100%"
          preserveAspectRatio="xMaxYMid"
          {...(Platform.OS === "web" ? undefined : { shouldRasterizeIOS: true })}
        />
      </XStack>
    </XStack>
  );
}

function CardStatusSkeleton() {
  return (
    <View borderRadius="$r4" overflow="hidden">
      <XStack
        backgroundColor="black"
        borderRadius="$r4"
        alignItems="center"
        height={136}
        justifyContent="space-between"
        padding="$s4"
      >
        <YStack height="100%" justifyContent="space-between" alignItems="flex-start" zIndex={2} flex={1}>
          <Skeleton height={24} width={120} />
          <Skeleton height={36} width={160} />
          <Skeleton height={16} width={80} />
        </YStack>
        <Skeleton height={120} width={180} />
      </XStack>
    </View>
  );
}
