import { ArrowRight, Info, X } from "@tamagui/lucide-icons";
import React from "react";
import { Platform, Pressable } from "react-native";
import { ScrollView, Sheet, XStack, YStack } from "tamagui";

import Defi from "../../assets/images/defi.svg";
import reportError from "../../utils/reportError";
import useAspectRatio from "../../utils/useAspectRatio";
import useIntercom from "../../utils/useIntercom";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function IntroSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const aspectRatio = useAspectRatio();
  const { presentArticle } = useIntercom();
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
      disableDrag
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
        <SafeView
          paddingTop={0}
          fullScreen
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundSoft"
        >
          <View position="absolute" top="$s5" right="$s5" zIndex={100_000}>
            <Pressable onPress={onClose} hitSlop={15}>
              <X size={25} color="$uiNeutralSecondary" />
            </Pressable>
          </View>
          <ScrollView $platform-web={{ maxHeight: "100vh" }}>
            <View fullScreen flex={1}>
              <YStack flex={1} padding="$s4" gap="$s6">
                <YStack flex={1} justifyContent="center">
                  <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
                    <Defi width="100%" height="100%" />
                  </View>
                  <YStack gap="$s4" alignSelf="center">
                    <Text emphasized textAlign="center" color="$interactiveTextBrandDefault" title>
                      Welcome to DeFi
                    </Text>
                    <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                      Access decentralized services provided by third-party DeFi protocols.
                    </Text>
                  </YStack>
                </YStack>
                <YStack gap="$s4_5">
                  <XStack alignItems="center" gap="$s4">
                    <XStack>
                      <Info size="$iconSize.md" strokeWidth="$iconStroke.md" color="$uiInfoSecondary" />
                    </XStack>
                    <Text color="$uiNeutralPlaceholder" caption2 textAlign="justify" flex={1}>
                      {/* cspell:ignoreRegExp \bdoesn&apos;t\b */}
                      The Exa App doesn&apos;t control your assets nor offer financial services. All integrations are
                      powered by independent third-party DeFi protocols.&nbsp;
                      <Text
                        color="$interactiveTextBrandDefault"
                        caption2
                        cursor="pointer"
                        onPress={() => {
                          presentArticle("11731646").catch(reportError);
                        }}
                      >
                        Learn more about connecting your wallet to DeFi.
                      </Text>
                    </Text>
                  </XStack>
                  <Button onPress={onClose} primary>
                    <Button.Text>Explore decentralized services</Button.Text>
                    <Button.Icon>
                      <ArrowRight />
                    </Button.Icon>
                  </Button>
                </YStack>
              </YStack>
            </View>
          </ScrollView>
        </SafeView>
      </Sheet.Frame>
    </Sheet>
  );
}
