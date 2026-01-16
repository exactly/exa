import React from "react";
import { Pressable } from "react-native";

import { Check } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";
import View from "../shared/View";

export default function Step({
  title,
  description,
  icon,
  action,
  onPress,
  completed,
}: {
  action: string;
  completed: boolean;
  description: string;
  icon: React.ReactNode;
  onPress: () => void;
  title: string;
}) {
  if (completed) {
    return (
      <XStack
        backgroundColor="$interactiveBaseSuccessSoftDefault"
        alignItems="center"
        padding="$s4_5"
        borderRadius="$r3"
        borderWidth={1}
        borderColor="$borderSuccessSoft"
        gap="$s3_5"
      >
        <View
          width={24}
          height={24}
          borderRadius="$r_0"
          backgroundColor="$uiSuccessSecondary"
          borderWidth={2}
          borderColor="$uiSuccessTertiary"
          alignItems="center"
          justifyContent="center"
          padding="$s2"
        >
          <Check size={14} strokeWidth={4} color="$interactiveOnBaseSuccessDefault" />
        </View>
        <Text emphasized subHeadline color="$uiBrandSecondary">
          {title}
        </Text>
      </XStack>
    );
  }

  return (
    <XStack
      backgroundColor="$backgroundSoft"
      alignItems="center"
      padding="$s4_5"
      borderRadius="$r3"
      borderWidth={1}
      borderColor="$borderNeutralSoft"
      gap="$s3_5"
    >
      {icon}
      <YStack gap="$s4_5" flex={1}>
        <YStack gap="$s3_5">
          <Text emphasized subHeadline primary>
            {title}
          </Text>
          <Text footnote secondary>
            {description}
          </Text>
        </YStack>
        <Pressable hitSlop={15} onPress={onPress}>
          <Text emphasized footnote color="$interactiveBaseBrandDefault">
            {action}
          </Text>
        </Pressable>
      </YStack>
    </XStack>
  );
}
