import React from "react";
import { Pressable } from "react-native";

import { ChevronRight } from "@tamagui/lucide-icons-2";
import { Spinner, XStack, YStack } from "tamagui";

import Text from "../shared/Text";

export default function Task({
  icon,
  tag,
  title,
  description,
  action,
  loading,
  onPress,
}: {
  action: string;
  description: string;
  icon: React.ReactNode;
  loading?: boolean;
  onPress?: () => void;
  tag?: React.ReactElement;
  title: string;
}) {
  return (
    <YStack
      backgroundColor="$backgroundSoft"
      borderWidth={1}
      borderColor="$borderNeutralSoft"
      borderRadius="$r5"
      paddingTop="$s4_5"
      paddingBottom="$s4"
      paddingHorizontal="$s3_5"
      gap="$s4_5"
    >
      <YStack gap="$s3_5">
        {tag && <XStack paddingLeft="$s6">{tag}</XStack>}
        <XStack alignItems="center" gap="$s3_5">
          {icon}
          <YStack flex={1} gap="$s3_5">
            <Text emphasized subHeadline primary>
              {title}
            </Text>
            <Text footnote secondary>
              {description}
            </Text>
          </YStack>
        </XStack>
      </YStack>
      <Pressable hitSlop={15} disabled={!onPress || loading} onPress={onPress} style={{ alignSelf: "flex-start" }}>
        <XStack alignItems="center" gap="$s2" paddingLeft="$s6">
          <Text emphasized footnote color={onPress ? "$interactiveBaseBrandDefault" : "$interactiveOnDisabled"}>
            {action}
          </Text>
          {loading ? (
            <Spinner width={16} height={16} color="$interactiveBaseBrandDefault" />
          ) : (
            <ChevronRight size={16} color={onPress ? "$interactiveBaseBrandDefault" : "$interactiveOnDisabled"} />
          )}
        </XStack>
      </Pressable>
    </YStack>
  );
}
