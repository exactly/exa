import React from "react";
import { useTranslation } from "react-i18next";
import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";

export default function LoanActivity() {
  const { t } = useTranslation();
  return (
    <YStack backgroundColor="$backgroundSoft" borderRadius="$s3">
      <XStack padding="$s4">
        <Text emphasized body primary>
          {t("Loan activity")}
        </Text>
      </XStack>
      <YStack padding="$s4">
        <YStack alignItems="center" justifyContent="center" gap="$s4_5">
          <Text textAlign="center" color="$uiNeutralSecondary" emphasized title>
            🎉
          </Text>
          <Text textAlign="center" color="$uiBrandSecondary" emphasized headline>
            {t("You're all set!")}
          </Text>
          <Text textAlign="center" color="$uiNeutralSecondary" subHeadline>
            {t("Any purchases made with Pay Later will show up here.")}
          </Text>
        </YStack>
      </YStack>
    </YStack>
  );
}
