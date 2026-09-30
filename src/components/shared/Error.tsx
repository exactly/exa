import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { File } from "@tamagui/lucide-icons-2";
import { YStack } from "tamagui";

import * as Sentry from "@sentry/react-native";

import Image from "./Image";
import SafeView from "./SafeView";
import Button from "./StyledButton";
import Text from "./Text";
import errorImage from "../../assets/images/error.webp";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";

export default function Error({ resetError }: { resetError: () => void }) {
  const { t } = useTranslation();
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
              {t("Something’s not working as expected")}
            </Text>
            <Text color="$uiNeutralSecondary" footnote textAlign="center">
              <Trans
                i18nKey="Check out our <x>X</x> or <discord>Discord</discord> for updates—or report the issue so we can take a closer look."
                components={{
                  x: (
                    <Text
                      footnote
                      textDecorationLine="underline"
                      color="$interactiveBaseBrandDefault"
                      role="link"
                      aria-label={t("Open Exa on X")}
                      onPress={() => {
                        openBrowser("https://x.com/Exa_App").catch(reportError);
                      }}
                    />
                  ),
                  discord: (
                    <Text
                      footnote
                      textDecorationLine="underline"
                      color="$interactiveBaseBrandDefault"
                      role="link"
                      aria-label={t("Open Exa Discord")}
                      onPress={() => {
                        openBrowser("https://discord.gg/fBdVmbH38Y").catch(reportError);
                      }}
                    />
                  ),
                }}
              />
            </Text>
          </YStack>
        </YStack>
      </YStack>
      <YStack paddingBottom="$s7" gap="$s4">
        <Button
          onPress={() => {
            Sentry.showFeedbackWidget();
          }}
          primary
          width="100%"
        >
          <Button.Text>{t("Send error report")}</Button.Text>
          <Button.Icon>
            <File />
          </Button.Icon>
        </Button>
        <Pressable
          onPress={() => {
            resetError();
          }}
        >
          <Text emphasized footnote centered color="$interactiveBaseBrandDefault">
            {t("Retry")}
          </Text>
        </Pressable>
      </YStack>
    </SafeView>
  );
}
