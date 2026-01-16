import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";

import { YStack } from "tamagui";

import EmptyActivity from "../../assets/images/activity-empty.svg";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Empty() {
  const { t } = useTranslation();
  return (
    <View fullScreen padding="$s5" alignItems="center" justifyContent="center" backgroundColor="$backgroundSoft">
      <YStack gap="$s6" alignItems="center" justifyContent="center">
        <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
          <View width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
            <EmptyActivity width="100%" height="100%" />
          </View>
        </View>
        <YStack alignItems="center" justifyContent="center" gap="$s6">
          <Text emphasized title color="$interactiveTextBrandDefault" textAlign="center">
            {t("No activity yet")}
          </Text>
          <Text footnote secondary textAlign="center">
            {t(
              "Nothing to see here for now. Once you add funds or make a payment, all your account activity will appear in this section.",
            )}
          </Text>
        </YStack>
      </YStack>
    </View>
  );
}
