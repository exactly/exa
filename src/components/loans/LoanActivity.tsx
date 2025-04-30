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
      <YStack padding="$s4">
        <YStack alignItems="center" justifyContent="center" gap="$s4_5">
          <Text textAlign="center" color="$uiNeutralSecondary" emphasized title>
            🎉
          </Text>
          <Text textAlign="center" color="$uiBrandSecondary" emphasized headline>
            You&apos;re all set!
          </Text>
          <Text textAlign="center" color="$uiNeutralSecondary" subHeadline>
            Any purchases made with Pay Later will show up here.
          </Text>
        </YStack>
      </YStack>
    </YStack>
  );
}
