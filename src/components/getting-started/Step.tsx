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
  status,
  tag,
}: {
  action?: string;
  description?: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  status: "completed" | "failed" | "pending" | "review";
  tag?: string;
  title: string;
}) {
  if (status === "completed") {
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
          width={20}
          height={20}
          borderRadius="$r_0"
          backgroundColor="$uiSuccessSecondary"
          borderWidth={1}
          borderColor="$uiSuccessTertiary"
          alignItems="center"
          justifyContent="center"
        >
          <Check size={12} strokeWidth={4} color="$interactiveOnBaseSuccessDefault" />
        </View>
        <Text emphasized subHeadline color="$interactiveOnBaseSuccessSoft">
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
        {tag && (
          <XStack
            alignSelf="flex-start"
            backgroundColor={status === "failed" ? "$interactiveBaseErrorDefault" : "$interactiveBaseWarningDefault"}
            borderRadius="$r2"
            paddingHorizontal="$s2"
            paddingVertical="$s1"
          >
            <Text
              emphasized
              caption2
              color={status === "failed" ? "$interactiveOnBaseErrorDefault" : "$interactiveOnBaseWarningDefault"}
            >
              {tag}
            </Text>
          </XStack>
        )}
        <YStack gap="$s3_5">
          <Text emphasized subHeadline primary>
            {title}
          </Text>
          <Text footnote secondary>
            {description}
          </Text>
        </YStack>
        {action && (
          <Pressable hitSlop={15} onPress={onPress}>
            <Text emphasized footnote color="$interactiveBaseBrandDefault">
              {action}
            </Text>
          </Pressable>
        )}
      </YStack>
    </XStack>
  );
}
