import React, { type ReactNode } from "react";

import { Info } from "@tamagui/lucide-icons-2/icons/Info";
import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";

export default function AssetSection({
  children,
  onInfoPress,
  title,
}: {
  children: ReactNode;
  onInfoPress: () => void;
  title?: string;
}) {
  return (
    <YStack
      paddingVertical="s3"
      transition="default"
      opacity="enter:0"
      transform="translateY(0px) enter:translateY(20px)"
    >
      {title ? (
        <XStack padding="s4" alignItems="center" gap="s2" cursor="pointer" onPress={onInfoPress}>
          <Text emphasized headline color="uiNeutralPrimary">
            {title}
          </Text>
          <Info size={16} color="interactiveOnBaseBrandSoft" />
        </XStack>
      ) : null}
      <YStack paddingHorizontal="s4" paddingTop="s4" paddingBottom="s4_5" gap="s6">
        {children}
      </YStack>
    </YStack>
  );
}
