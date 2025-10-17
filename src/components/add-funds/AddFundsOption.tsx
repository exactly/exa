import { ChevronRight } from "@tamagui/lucide-icons";
import React from "react";
import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";
import View from "../shared/View";

export default function AddFundsOption({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: React.ReactElement;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <YStack padding="$s4_5" backgroundColor="$backgroundSoft" borderRadius="$r5" cursor="pointer" onPress={onPress}>
      <XStack alignItems="center" gap="$s3_5" justifyContent="space-between">
        <XStack gap="$s3_5" alignItems="center" flex={1}>
          <View
            width={40}
            height={40}
            backgroundColor="$interactiveBaseBrandSoftDefault"
            borderRadius="$r3"
            padding="$s3"
            alignItems="center"
            justifyContent="center"
          >
            {icon}
          </View>
          <YStack flex={1}>
            <Text emphasized headline primary>
              {title}
            </Text>
            <Text footnote secondary>
              {subtitle}
            </Text>
          </YStack>
        </XStack>
        <View>
          <ChevronRight size={24} color="$uiBrandSecondary" />
        </View>
      </XStack>
    </YStack>
  );
}
