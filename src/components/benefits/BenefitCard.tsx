import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { ChevronRight } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";

import type { Benefit } from "./BenefitsSection";

type BenefitCardProperties = {
  benefit: Benefit;
  onPress: () => void;
};

export default memo(function BenefitCard({ benefit, onPress }: BenefitCardProperties) {
  const { t } = useTranslation();
  const BenefitLogo = benefit.logo;
  const tap = useMemo(
    () =>
      /* istanbul ignore next */
      Gesture.Tap().runOnJS(true).onEnd(onPress),
    [onPress],
  );
  return (
    <GestureDetector gesture={tap}>
      <YStack
        borderRadius="$r4"
        padding="$s4"
        height={160}
        justifyContent="space-between"
        cursor="pointer"
        overflow="hidden"
      >
        <benefit.Background />
        <YStack gap="$s3_5" maxWidth="60%">
          <XStack alignItems="center" gap="$s2">
            <BenefitLogo width={20} height={20} />
            <Text subHeadline color="$backgroundBrandMild">
              {t(benefit.partner)}
            </Text>
          </XStack>
          <Text emphasized title2 color="$backgroundBrandSoft">
            {t(benefit.title)}
          </Text>
        </YStack>
        <XStack justifyContent="space-between">
          <XStack alignItems="center" gap="$1">
            <Text emphasized footnote color="$interactiveBaseBrandSoftDefault">
              {benefit.linkText ? t(benefit.linkText) : t("Get now")}
            </Text>
            <ChevronRight color="$interactiveBaseBrandSoftDefault" size={16} />
          </XStack>
        </XStack>
      </YStack>
    </GestureDetector>
  );
});
