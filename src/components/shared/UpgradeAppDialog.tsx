import { ArrowRight } from "@tamagui/lucide-icons";
import React from "react";
import { Linking, Platform } from "react-native";
import { AlertDialog, XStack, YStack } from "tamagui";

import Button from "./Button";
import Text from "./Text";
import handleError from "../../utils/handleError";

export default function UpgradeAppDialog() {
  return (
    <AlertDialog open>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          key="overlay"
          backgroundColor="black"
          opacity={0.5}
          animation="quicker"
          enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
          exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        />
        <AlertDialog.Content
          key="content"
          animation={["quicker", { opacity: { overshootClamping: true } }]}
          enterStyle={{ x: 0, y: -20, opacity: 0, scale: 0.9 }} // eslint-disable-line react-native/no-inline-styles
          exitStyle={{ x: 0, y: 10, opacity: 0, scale: 0.95 }} // eslint-disable-line react-native/no-inline-styles
          x={0}
          y={0}
          scale={1}
          opacity={1}
          borderWidth={0}
          margin="$s5"
        >
          <YStack backgroundColor="$backgroundSoft" borderRadius="$r6" padding="$s5" paddingTop="$s5" gap="$s5">
            <XStack alignItems="center" gap="$s3" justifyContent="flex-start">
              <AlertDialog.Title>
                <Text emphasized headline>
                  Upgrade required
                </Text>
              </AlertDialog.Title>
            </XStack>
            <YStack gap="$s6">
              <YStack>
                <Text secondary subHeadline>
                  You need to update your app to keep using your onchain assets.
                </Text>
              </YStack>
              <XStack>
                <AlertDialog.Action asChild flex={1}>
                  <Button
                    onPress={() => {
                      Linking.openURL(
                        Platform.OS === "ios"
                          ? "https://apps.apple.com/app/exa-app/id6572315454"
                          : "https://play.google.com/store/apps/details?id=app.exactly",
                      ).catch(handleError);
                    }}
                    contained
                    main
                    spaced
                    fullwidth
                    iconAfter={<ArrowRight strokeWidth={3} color="$interactiveOnBaseBrandDefault" />}
                  >
                    {`Open ${Platform.OS === "ios" ? "App" : "Play"} Store`}
                  </Button>
                </AlertDialog.Action>
              </XStack>
            </YStack>
          </YStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  );
}
