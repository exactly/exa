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
  const tap = useMemo(() => Gesture.Tap().onEnd(onPress), [onPress]);
  return (
    <GestureDetector gesture={tap}>
      <YStack
        backgroundColor="$backgroundBrandSoft"
        borderRadius="$3"
        paddingVertical="$s5"
        paddingHorizontal="$s4"
        gap="$s7"
        cursor="pointer"
      >
        <YStack gap="$s2">
          <Text footnote secondary>
            {t(benefit.subtitle)}
          </Text>
          <Text emphasized headline>
            {t(benefit.title)}
          </Text>
        </YStack>
        <XStack justifyContent="space-between">
          <XStack alignItems="center" gap="$s2">
            <BenefitLogo width={24} height={24} />
            <Text emphasized callout>
              {t(benefit.partner)}
            </Text>
          </XStack>
          <XStack alignItems="center" gap="$1">
            <Text emphasized footnote color="$interactiveBaseBrandDefault">
              {benefit.linkText ? t(benefit.linkText) : t("Get now")}
            </Text>
            <ChevronRight color="$uiBrandSecondary" size={16} />
          </XStack>
        </XStack>
      </YStack>
    </GestureDetector>
  );
});
