import * as Sentry from "@sentry/react-native";
import { File } from "@tamagui/lucide-icons";
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { YStack } from "tamagui";

import Button from "./Button";
import SafeView from "./SafeView";
import Text from "./Text";
import View from "./View";
import ErrorImage from "../../assets/images/error.svg";
import reportError from "../../utils/reportError";
import useOpenBrowser from "../../utils/useOpenBrowser";

export default function Error({ resetError }: { resetError: () => void }) {
  const openBrowser = useOpenBrowser();
  return (
    <SafeView fullScreen gap="$s4" padded backgroundColor="$backgroundSoft">
      <YStack flex={1} paddingHorizontal="$s6" gap="$s7">
        <YStack flex={1} justifyContent="center" gap="$s3_5">
          <View width="100%" aspectRatio={1.2} justifyContent="center" alignItems="center">
            <View width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
              <ErrorImage width="100%" height="100%" />
            </View>
          </View>
          <YStack gap="$s5">
            <Text emphasized textAlign="center" color="$interactiveTextBrandDefault" title>
              Something&apos;s not working as expected
            </Text>
            <Text color="$uiNeutralSecondary" footnote textAlign="center">
              Check out our&nbsp;
              <Text
                textDecorationLine="underline"
                color="$interactiveBaseBrandDefault"
                onPress={() => {
                  openBrowser("https://x.com/Exa_App").catch(reportError);
                }}
              >
                X
              </Text>
              &nbsp;or&nbsp;
              <Text
                textDecorationLine="underline"
                color="$interactiveBaseBrandDefault"
                onPress={() => {
                  openBrowser("https://discord.gg/fBdVmbH38Y").catch(reportError);
                }}
              >
                Discord
              </Text>
              &nbsp;for updates—or report the issue so we can take a closer look.
            </Text>
          </YStack>
        </YStack>
      </YStack>
      <YStack paddingHorizontal="$s5" paddingBottom="$s7" gap="$s4">
        <Button
          onPress={() => {
            Sentry.showFeedbackWidget();
          }}
          flexBasis={64}
          contained
          main
          spaced
          fullwidth
          iconAfter={<File strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
        >
          Send error report
        </Button>
        <Pressable
          onPress={() => {
            resetError();
          }}
        >
          <Text emphasized footnote centered color="$interactiveBaseBrandDefault">
            Retry
          </Text>
        </Pressable>
      </YStack>
    </SafeView>
  );
}
