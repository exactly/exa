import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";

import { ArrowUpToLine, CreditCard, IdCard } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import ExaCard from "../../../assets/images/exa-card.svg";
import Button from "../../shared/StyledButton";
import Text from "../../shared/Text";
import View from "../../shared/View";

export default function Intro({ onPress }: { onPress: () => void }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <View fullScreen flex={1} gap="$s7">
      <YStack flex={1} paddingHorizontal="$s6" gap="$s7">
        <YStack flex={1} justifyContent="center" gap="$s3_5">
          <View width="100%" aspectRatio={1.2} justifyContent="center" alignItems="center" position="relative">
            <View width="100%" height="100%" style={StyleSheet.absoluteFill}>
              <ExaCard width="100%" height="100%" />
            </View>
          </View>
          <YStack gap="$s5">
            <Text emphasized textAlign="center" color="$interactiveTextBrandDefault" title>
              {t("Upgrade to your new Exa Card")}
            </Text>
            <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
              {t(
                "Upgrade your Exa Card in 3 steps to keep spending seamlessly. Your current card works until {{date}}, but upgrading will be required after that.",
                { date: new Intl.DateTimeFormat(language, { dateStyle: "long" }).format(UPGRADE_DEADLINE) },
              )}
            </Text>
          </YStack>
        </YStack>
        <YStack gap="$s3_5">
          <XStack gap="$s3" alignItems="center" justifyContent="center">
            <IdCard strokeWidth={2.5} color="$uiBrandSecondary" />
            <Text color="$uiBrandSecondary" emphasized headline>
              {t("Verify your identity")}
            </Text>
          </XStack>
          <XStack gap="$s3" alignItems="center" justifyContent="center">
            <ArrowUpToLine strokeWidth={2.5} color="$uiBrandSecondary" />
            <Text color="$uiBrandSecondary" emphasized headline>
              {t("Upgrade your account")}
            </Text>
          </XStack>
          <XStack gap="$s3" alignItems="center" justifyContent="center">
            <CreditCard strokeWidth={2.5} color="$uiBrandSecondary" />
            <Text color="$uiBrandSecondary" emphasized headline>
              {t("Activate your new Exa Card")}
            </Text>
          </XStack>
        </YStack>
      </YStack>
      <YStack paddingHorizontal="$s5" paddingBottom="$s7">
        <Button primary width="100%" onPress={onPress}>
          <Button.Text>{t("Verify your identity")}</Button.Text>
          <Button.Icon>
            <IdCard />
          </Button.Icon>
        </Button>
      </YStack>
    </View>
  );
}

export const UPGRADE_DEADLINE = new Date(2025, 5, 21);
