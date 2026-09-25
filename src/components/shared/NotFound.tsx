import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, StyleSheet } from "react-native";

import { SplashScreen, useRouter, useUnstableGlobalHref } from "expo-router";

import { ExternalLink } from "@tamagui/lucide-icons-2";
import { YStack } from "tamagui";

import domain from "@exactly/common/domain";

import SafeView from "./SafeView";
import Button from "./StyledButton";
import Text from "./Text";
import ThemedSvg from "./ThemedSvg";
import View from "./View";
import errorImage from "../../assets/images/error.svg";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";

export default function NotFound() {
  const { t } = useTranslation();
  const router = useRouter();
  const href = useUnstableGlobalHref();

  useEffect(() => {
    SplashScreen.hideAsync().catch(reportError);
  }, []);

  return (
    <SafeView fullScreen gap="$s4" padded backgroundColor="$backgroundSoft">
      <YStack flex={1} paddingHorizontal="$s5" gap="$s7">
        <YStack flex={1} justifyContent="center" gap="$s3_5">
          <View width="100%" aspectRatio={1.2} justifyContent="center" alignItems="center">
            <View width="100%" height="100%" style={StyleSheet.absoluteFill}>
              <ThemedSvg xml={errorImage} width="100%" height="100%" />
            </View>
          </View>
          <YStack gap="$s5">
            <Text emphasized textAlign="center" color="$interactiveTextBrandDefault" title>
              {t("We couldn’t find that page")}
            </Text>
            <Text color="$uiNeutralSecondary" footnote textAlign="center">
              {t("The link you followed doesn’t match any screen in the app.")}
            </Text>
          </YStack>
        </YStack>
      </YStack>
      <YStack paddingHorizontal="$s5" paddingBottom="$s7" gap="$s4">
        {Platform.OS !== "web" && (
          <Button
            onPress={() => {
              openBrowser(`https://${domain}${href}`).catch(reportError);
            }}
            primary
            width="100%"
          >
            <Button.Text>{t("Open in browser")}</Button.Text>
            <Button.Icon>
              <ExternalLink />
            </Button.Icon>
          </Button>
        )}
        <Pressable
          onPress={() => {
            router.replace("/");
          }}
        >
          <Text emphasized footnote centered color="$interactiveBaseBrandDefault">
            {t("Go home")}
          </Text>
        </Pressable>
      </YStack>
    </SafeView>
  );
}
