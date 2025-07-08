import { X } from "@tamagui/lucide-icons";
import { openBrowserAsync } from "expo-web-browser";
import React from "react";
import { Platform } from "react-native";
import { ScrollView, Sheet, YStack } from "tamagui";

import reportError from "../../utils/reportError";
import useAspectRatio from "../../utils/useAspectRatio";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AboutDefiSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const aspectRatio = useAspectRatio();
  return (
    <Sheet
      open={open}
      dismissOnSnapToBottom
      unmountChildrenWhenHidden
      forceRemoveScrollEnabled={open}
      animation="moderate"
      dismissOnOverlayPress
      onOpenChange={onClose}
      snapPointsMode="fit"
      zIndex={100_000}
      modal
      portalProps={Platform.OS === "web" ? { style: { aspectRatio, justifySelf: "center" } } : undefined}
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Frame>
        <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
          <ScrollView $platform-web={{ maxHeight: "100vh" }}>
            <View fullScreen flex={1}>
              <YStack flex={1} padding="$s4" gap="$s6">
                <YStack gap="$s4_5">
                  <YStack gap="$s4">
                    <Text headline emphasized>
                      About DeFi
                    </Text>
                    <Text subHeadline color="$uiNeutralPlaceholder">
                      Here you&apos;ll find integrations with decentralized services powered by our partners. Exa App
                      never controls your assets or how you use them when connected to the integrations provided by our
                      partners.
                    </Text>

                    <Button
                      flexBasis={60}
                      onPress={onClose}
                      contained
                      main
                      spaced
                      fullwidth
                      iconAfter={<X strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
                    >
                      Close
                    </Button>
                    <Text
                      footnote
                      emphasized
                      color="$interactiveTextBrandDefault"
                      cursor="pointer"
                      textAlign="center"
                      onPress={() => {
                        openBrowserAsync(
                          `https://intercom.help/exa-app/en/articles/9942510-exa-app-terms-and-conditions`,
                        ).catch(reportError);
                      }}
                    >
                      Learn more about integrations
                    </Text>
                  </YStack>
                </YStack>
              </YStack>
            </View>
          </ScrollView>
        </SafeView>
      </Sheet.Frame>
    </Sheet>
  );
}
