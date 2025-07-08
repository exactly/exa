import { ArrowRight, XCircle } from "@tamagui/lucide-icons";
import { useNavigation } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { XStack, YStack } from "tamagui";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import DeFiBanner from "../../assets/images/defi-banner.svg";
import queryClient from "../../utils/queryClient";
import Text from "../shared/Text";

export default function ExploreDeFi() {
  const navigation = useNavigation<AppNavigationProperties>();
  const { t } = useTranslation();
  return (
    <XStack
      backgroundColor="$interactiveBaseBrandDefault"
      borderRadius="$r4"
      alignItems="center"
      overflow="hidden"
      height={142}
      justifyContent="space-between"
      padding="$s4"
      cursor="pointer"
      gap="$s2"
      onPress={() => {
        navigation.navigate("(home)", { screen: "defi" });
      }}
    >
      <YStack height="100%" justifyContent="space-between" alignItems="flex-start" zIndex={2} maxWidth="50%">
        <Text textAlign="left" maxFontSizeMultiplier={1} emphasized body color="$backgroundBrandSoft">
          {t("Access decentralized tools for funding, swaps, and more")}
        </Text>
        <XStack alignSelf="flex-start" alignItems="center" gap="$s2">
          <Text emphasized footnote color="$interactiveBaseBrandSoftDefault" maxFontSizeMultiplier={1}>
            {t("Explore DeFi")}
          </Text>
          <ArrowRight size={16} color="$interactiveBaseBrandSoftDefault" />
        </XStack>
      </YStack>
      <XStack position="absolute" right={0} left={0} top={0} bottom={0} justifyContent="flex-end">
        <DeFiBanner
          width="50%"
          height="100%"
          preserveAspectRatio="xMaxYMid"
          {...(Platform.OS === "web" ? undefined : { shouldRasterizeIOS: true })}
        />
      </XStack>
      <XStack
        position="absolute"
        right="$s4"
        top="$s4"
        justifyContent="flex-end"
        cursor="pointer"
        zIndex={3}
        onPress={(event) => {
          event.stopPropagation();
          queryClient.setQueryData(["settings", "explore-defi-shown"], false);
        }}
      >
        <XCircle size={20} color="$backgroundBrandSoft" />
      </XStack>
    </XStack>
  );
}
