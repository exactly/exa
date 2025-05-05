import { ArrowRight, X } from "@tamagui/lucide-icons";
import React from "react";
import { Platform, Pressable } from "react-native";
import { ScrollView, Sheet, YStack } from "tamagui";

import VerifyIdentity from "../../assets/images/verify-identity.svg";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function VerificationFailure({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { present } = useIntercom();
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
      portalProps={Platform.OS === "web" ? { style: { aspectRatio: 10 / 16, justifySelf: "center" } } : undefined}
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Frame>
        <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
          <View position="absolute" top="$s5" right="$s5" zIndex={100_000}>
            <Pressable onPress={onClose} hitSlop={15}>
              <X size={25} color="$uiNeutralSecondary" />
            </Pressable>
          </View>
          <ScrollView>
            <View fullScreen flex={1}>
              <YStack flex={1} padding="$s4">
                <YStack flex={1} justifyContent="center" gap="$s4">
                  <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
                    <View width="100%" height="100%" justifyContent="center" alignItems="center">
                      <VerifyIdentity width="100%" height="100%" />
                    </View>
                  </View>
                </YStack>
                <YStack gap="$s4_5">
                  <Text emphasized textAlign="center" color="$interactiveTextBrandDefault" title>
                    We couldn&apos;t verify your identity{/* cspell:ignoreRegExp \bcouldn&apos;t\b */}
                  </Text>
                  <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                    This may be due to missing or incorrect information. Please contact support to resolve it.
                  </Text>
                  <Button
                    flexBasis={60}
                    onPress={() => {
                      present().catch(reportError);
                    }}
                    contained
                    main
                    spaced
                    fullwidth
                    iconAfter={<ArrowRight strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
                  >
                    Contact support
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
