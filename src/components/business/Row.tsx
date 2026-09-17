import React from "react";
import { Pressable } from "react-native";

import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";

export default function Row({
  icon,
  title,
  description,
  tag,
  onPress,
}: {
  description?: string;
  icon: React.ReactNode;
  onPress?: () => void;
  tag: React.ReactNode;
  title: string;
}) {
  return (
    <Pressable disabled={!onPress} onPress={onPress}>
      <XStack
        alignItems="center"
        gap="$s3_5"
        paddingVertical="$s4"
        paddingHorizontal="$s3"
        borderBottomWidth={1}
        borderBottomColor="$borderNeutralSoft"
      >
        {icon}
        <YStack flex={1} gap="$s2">
          <Text emphasized subHeadline primary>
            {title}
          </Text>
          {description && (
            <Text caption secondary>
              {description}
            </Text>
          )}
        </YStack>
        {tag}
      </XStack>
    </Pressable>
  );
}
