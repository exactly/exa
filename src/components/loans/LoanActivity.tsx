import React from "react";
import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";

export default function LoanActivity() {
  return (
    <YStack backgroundColor="$backgroundSoft" borderRadius="$s3">
      <XStack padding="$s4">
        <Text emphasized body primary>
          Loan activity
        </Text>
      </XStack>
      <YStack padding="$s4" />
    </YStack>
  );
}
