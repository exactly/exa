import React, { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

import { ChevronRight } from "@tamagui/lucide-icons";
import { useTheme, XStack, YStack } from "tamagui";

import Text from "../shared/Text";

import type { Benefit } from "./BenefitsSection";

type BenefitCardProperties = {
  benefit: Benefit;
  onPress: () => void;
};

export default memo(function BenefitCard({ benefit, onPress }: BenefitCardProperties) {
  const { t } = useTranslation();
  const theme = useTheme();
  const brandColor = theme.interactiveBaseBrandDefault.val;
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
        <Image source={benefit.background} style={StyleSheet.absoluteFill} contentFit="cover" />
        <LinearGradient
          colors={[brandColor, `${brandColor}00`]}
          locations={[0.2444, 0.7542]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
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
