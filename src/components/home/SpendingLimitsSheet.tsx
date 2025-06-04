import { X } from "@tamagui/lucide-icons";
import React from "react";
import { Platform, Pressable } from "react-native";
import { ScrollView, Sheet, XStack, YStack } from "tamagui";

import reportError from "../../utils/reportError";
import useAspectRatio from "../../utils/useAspectRatio";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function SpendingLimitsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
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
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <SafeView
            borderTopLeftRadius="$r4"
            borderTopRightRadius="$r4"
            backgroundColor="$backgroundSoft"
            paddingHorizontal="$s5"
            $platform-web={{ paddingVertical: "$s7" }}
          >
            <YStack gap="$s7">
              <YStack gap="$s5">
                <Text emphasized primary headline>
                  Spending limit
                </Text>
                <Text primary subHeadline>
                  Your spending limit is the maximum amount you can spend on your Exa Card.
                </Text>
              </YStack>
              <YStack gap="$s3_5">
                <YStack
                  gap="$s3_5"
                  borderRadius="$r3"
                  backgroundColor="$backgroundMild"
                  paddingHorizontal="$s4"
                  paddingVertical="$s4_5"
                >
                  <XStack gap="$s3" alignItems="center" flexWrap="wrap">
                    <Text emphasized secondary footnote>
                      WHEN
                    </Text>
                    <View
                      alignSelf="center"
                      justifyContent="center"
                      alignItems="center"
                      backgroundColor="$cardDebitInteractive"
                      borderRadius="$r2"
                      paddingVertical="$s2"
                      paddingHorizontal="$s3"
                    >
                      <Text
                        emphasized
                        secondary
                        footnote
                        textTransform="uppercase"
                        color="$cardDebitText"
                        maxFontSizeMultiplier={1}
                      >
                        PAY NOW
                      </Text>
                    </View>
                    <Text emphasized secondary footnote>
                      IS ENABLED
                    </Text>
                  </XStack>
                  <Text subHeadline>Only your USDC balance counts toward your spending limit.</Text>
                </YStack>
                <YStack
                  gap="$s3_5"
                  borderRadius="$r3"
                  backgroundColor="$backgroundMild"
                  paddingHorizontal="$s4"
                  paddingVertical="$s4_5"
                >
                  <XStack gap="$s3" alignItems="center" flexWrap="wrap">
                    <Text emphasized secondary footnote>
                      WHEN
                    </Text>
                    <View
                      alignSelf="center"
                      justifyContent="center"
                      alignItems="center"
                      backgroundColor="$cardCreditInteractive"
                      borderRadius="$r2"
                      paddingVertical="$s2"
                      paddingHorizontal="$s3"
                    >
                      <Text
                        emphasized
                        secondary
                        footnote
                        textTransform="uppercase"
                        color="$cardCreditText"
                        maxFontSizeMultiplier={1}
                      >
                        INSTALLMENTS
                      </Text>
                    </View>
                    <Text emphasized secondary footnote>
                      IS ENABLED
                    </Text>
                  </XStack>
                  <Text subHeadline>All supported assets count toward your spending limit.</Text>
                </YStack>
              </YStack>
              <YStack gap="$s5">
                <Button
                  onPress={onClose}
                  flexBasis={60}
                  contained
                  main
                  spaced
                  fullwidth
                  iconAfter={<X strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
                >
                  Close
                </Button>
                <Pressable
                  onPress={() => {
                    presentArticle("9922633").catch(reportError);
                  }}
                >
                  <Text emphasized footnote color="$interactiveBaseBrandDefault" alignSelf="center">
                    Learn more about your spending limit
                  </Text>
                </Pressable>
              </YStack>
            </YStack>
          </SafeView>
        </ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}
