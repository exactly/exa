import React, { type ReactNode } from "react";

import { YStack } from "tamagui";

import Text from "../shared/Text";

export default function AssetSection({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
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
        <YStack padding="s4" gap="s2">
          <Text emphasized headline color="uiNeutralPrimary">
            {title}
          </Text>
          <Text footnote secondary>
            {description}
          </Text>
        </YStack>
      ) : null}
      <YStack paddingHorizontal="s4" paddingTop="s4" paddingBottom="s4_5" gap="s6">
        {children}
      </YStack>
    </YStack>
  );
}
