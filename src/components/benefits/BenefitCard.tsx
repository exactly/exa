import { ChevronRight } from "@tamagui/lucide-icons";
import React, { memo } from "react";
import { TapGestureHandler } from "react-native-gesture-handler";
import { YStack, XStack } from "tamagui";

import type { Benefit } from "./BenefitsSection";
import Text from "../shared/Text";

interface BenefitCardProperties {
  benefit: Benefit;
  onPress: () => void;
}

export default memo(function BenefitCard({ benefit, onPress }: BenefitCardProperties) {
  const BenefitLogo = benefit.logo;
  return (
    <TapGestureHandler onEnded={onPress}>
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
            {benefit.subtitle}
          </Text>
          <Text emphasized headline>
            {benefit.title}
          </Text>
        </YStack>
        <XStack justifyContent="space-between">
          <XStack alignItems="center" gap="$s2">
            <BenefitLogo width={24} height={24} />
            <Text emphasized callout>
              {benefit.partner}
            </Text>
          </XStack>
          <XStack alignItems="center" gap="$1">
            <Text emphasized footnote color="$interactiveBaseBrandDefault">
              {benefit.linkText ?? "Get now"}
            </Text>
            <ChevronRight color="$uiBrandSecondary" size={16} />
          </XStack>
        </XStack>
      </YStack>
    </TapGestureHandler>
  );
});
