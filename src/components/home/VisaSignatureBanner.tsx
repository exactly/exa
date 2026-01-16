import React from "react";
import { useTranslation } from "react-i18next";

import { ArrowRight } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import Image from "../shared/Image";
import Text from "../shared/Text";

export default function VisaSignatureBanner({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <XStack
      backgroundColor="$grayscaleLight12"
      borderRadius="$r4"
      alignItems="center"
      overflow="hidden"
      minHeight={120}
      cursor="pointer"
      onPress={onPress}
      position="relative"
      flex={1}
    >
      <YStack padding="$s4" gap="$s2" height="100%" flex={1}>
        <YStack height="100%" justifyContent="space-between" alignItems="flex-start">
          <Text textAlign="left" maxFontSizeMultiplier={1} emphasized body color="white">
            {t("Get your Visa Signature Exa Card")}
          </Text>
          <XStack alignSelf="flex-start" alignItems="center" gap="$s2">
            <Text emphasized footnote color="white" maxFontSizeMultiplier={1}>
              {t("Upgrade now")}
            </Text>
            <ArrowRight size={16} color="white" />
          </XStack>
        </YStack>
      </YStack>
      <YStack pointerEvents="none" height="100%" flexBasis="30%">
        <Image
          source={{ uri: "https://assets.exactly.app/signature-banner.png" }}
          height="100%"
          width="100%"
          objectFit="cover"
        />
      </YStack>
    </XStack>
  );
}
