import React, { memo } from "react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { Pressable } from "react-native-gesture-handler";

import { ChevronRight } from "@tamagui/lucide-icons-2";
import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";

import type { Benefit } from "./BenefitsSection";

type BenefitCardProperties = Pick<
  ComponentProps<typeof Pressable>,
  "accessibilityActions" | "onAccessibilityAction"
> & {
  benefit: Benefit;
  onPress: () => void;
  tabIndex: -1 | 0;
};

export default memo(function BenefitCard({ benefit, onPress, tabIndex, ...accessibility }: BenefitCardProperties) {
  const { t } = useTranslation();
  const BenefitLogo = benefit.logo;
  return (
    <Pressable
      accessible={Platform.OS === "web"}
      accessibilityRole={Platform.OS === "web" ? "button" : undefined}
      accessibilityLabel={
        Platform.OS === "web"
          ? `${t(benefit.partner)}: ${t(benefit.title)}. ${benefit.linkText ? t(benefit.linkText) : t("Get now")}`
          : undefined
      }
      tabIndex={tabIndex}
      onPress={onPress}
      {...(Platform.OS === "web" ? accessibility : {})}
    >
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
            <Text subHeadline color="$backgroundBrandMild" numberOfLines={1} adjustsFontSizeToFit flexShrink={1}>
              {t(benefit.partner)}
            </Text>
          </XStack>
          <Text emphasized title2 color="$backgroundBrandSoft" numberOfLines={2} adjustsFontSizeToFit>
            {t(benefit.title)}
          </Text>
        </YStack>
        <XStack justifyContent="space-between">
          <XStack
            alignItems="center"
            gap="$1"
            accessible={Platform.OS !== "web"}
            accessibilityLabel={
              Platform.OS === "web" ? undefined : benefit.linkText ? t(benefit.linkText) : t("Get now")
            }
            accessibilityRole={Platform.OS === "web" ? undefined : "button"}
            accessibilityHint={Platform.OS === "web" ? undefined : `${t(benefit.partner)}: ${t(benefit.title)}`}
            {...(Platform.OS !== "web" && { onAccessibilityTap: onPress, ...accessibility })}
          >
            <Text emphasized footnote color="$interactiveBaseBrandSoftDefault">
              {benefit.linkText ? t(benefit.linkText) : t("Get now")}
            </Text>
            <ChevronRight color="$interactiveBaseBrandSoftDefault" size={16} />
          </XStack>
        </XStack>
      </YStack>
    </Pressable>
  );
});
