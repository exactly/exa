import React from "react";
import { Pressable } from "react-native";

import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";

export default function Row({
  icon,
  title,
  description,
  disabled,
  tag,
  onPress,
}: {
  description?: string;
  disabled?: boolean;
  icon: React.ReactNode;
  onPress?: () => void;
  tag?: React.ReactNode;
  title: string;
}) {
  return (
    <Pressable disabled={!onPress} onPress={onPress}>
      <XStack alignItems="center" gap="s3" paddingHorizontal="s3_5" opacity={disabled ? 0.5 : 1}>
        {icon}
        <YStack flex={1} gap="s2">
          <Text emphasized subHeadline primary>
            {title}
          </Text>
          {description && (
            <Text caption secondary>
              {description}
            </Text>
          )}
        </YStack>
        <YStack>{tag}</YStack>
      </XStack>
    </Pressable>
  );
}
