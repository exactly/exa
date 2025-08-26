import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import { XStack, YStack } from "tamagui";

import CardLimits from "./CardLimits";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import Card from "../../assets/images/card.svg";
import { getCard } from "../../utils/server";

export default function CardStatus({ onInfoPress }: { onInfoPress: () => void }) {
  const navigation = useNavigation<AppNavigationProperties>();
  const { data: card } = useQuery({ queryKey: ["card", "details"], queryFn: getCard });
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
