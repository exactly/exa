import React from "react";
import { Pressable } from "react-native";

import { ChevronRight } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";

export default function Task({
  icon,
  tag,
  title,
  description,
  action,
  onPress,
}: {
  action: string;
  description: string;
  icon: React.ReactNode;
  onPress?: () => void;
  tag?: React.ReactNode;
  title: string;
}) {
  return (
    <XStack
      backgroundColor="$backgroundSoft"
      padding="$s4_5"
      borderRadius="$r3"
      borderWidth={1}
      borderColor="$borderNeutralSoft"
      alignItems="center"
      gap="$s3_5"
    >
      {icon}
      <YStack flex={1} gap="$s4">
        <YStack gap="$s2">
          {tag}
          <Text emphasized subHeadline primary>
            {title}
          </Text>
          <Text footnote secondary>
            {description}
          </Text>
        </YStack>
        <Pressable hitSlop={15} onPress={onPress}>
          <XStack alignItems="center" gap="$s2">
            <Text emphasized footnote color="$interactiveBaseBrandDefault">
              {action}
            </Text>
            <ChevronRight size={16} color="$interactiveBaseBrandDefault" />
          </XStack>
        </Pressable>
      </YStack>
    </XStack>
  );
}
