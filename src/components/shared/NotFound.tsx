import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable } from "react-native";

import { SplashScreen, useRouter, useUnstableGlobalHref } from "expo-router";

import { ExternalLink } from "@tamagui/lucide-icons-2";
import { YStack } from "tamagui";

import domain from "@exactly/common/domain";

import Image from "./Image";
import SafeView from "./SafeView";
import Button from "./StyledButton";
import Text from "./Text";
import errorImage from "../../assets/images/error.webp";
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
      <YStack flex={1} gap="$s7">
        <YStack flex={1} justifyContent="center" gap="$s3_5">
          <Image
            source={errorImage}
            contentFit="contain"
            width="100%"
            aspectRatio={1}
            flexShrink={1}
            paddingHorizontal="$s8"
          />
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
      <YStack paddingBottom="$s7" gap="$s4">
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
