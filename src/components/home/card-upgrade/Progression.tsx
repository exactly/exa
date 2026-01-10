import { useQuery } from "@tanstack/react-query";
import React from "react";
import { XStack, YStack } from "tamagui";

import Text from "../../shared/Text";
import View from "../../shared/View";

export default function Progression() {
  const { data: step } = useQuery<number | undefined>({ queryKey: ["card-upgrade"] });
  const remainingSteps = Math.max(0, 3 - (step ?? 0));
  return (
    <YStack gap="$s3_5">
      <XStack width="100%" justifyContent="space-between" gap="$s2">
        {Array.from({ length: 3 }).map((_, index) => (
          <View
            key={index} // eslint-disable-line @eslint-react/no-array-index-key
            flex={1}
            height={8}
            backgroundColor={index > (step ?? 0) - 1 ? "$uiBrandTertiary" : "$uiBrandSecondary"}
            borderRadius="$r4"
          />
        ))}
      </XStack>
      <Text color="$uiBrandTertiary" subHeadline>
        {`${remainingSteps} step${remainingSteps === 1 ? "" : "s"} remaining`}
      </Text>
    </YStack>
  );
}
