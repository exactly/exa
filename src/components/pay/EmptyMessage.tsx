import React from "react";

import { YStack } from "tamagui";

import Text from "../shared/Text";

export default function EmptyMessage({
  emoji,
  title,
  description,
}: {
  description: string;
  emoji: string;
  title: string;
}) {
  return (
    <YStack alignItems="center" gap="s4_5" padding="s5">
      <Text title aria-hidden>
        {emoji}
      </Text>
      <Text emphasized headline color="uiBrandSecondary" textAlign="center">
        {title}
      </Text>
      <Text subHeadline color="uiNeutralSecondary" textAlign="center">
        {description}
      </Text>
    </YStack>
  );
}
