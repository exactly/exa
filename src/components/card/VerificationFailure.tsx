import { ArrowRight, X } from "@tamagui/lucide-icons";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView, YStack } from "tamagui";

import VerifyIdentity from "../../assets/images/verify-identity.svg";
import { present } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import Button from "../shared/Button";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function VerificationFailure({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <View position="absolute" top="$s5" right="$s5" zIndex={100_000}>
          <Pressable onPress={onClose} hitSlop={15}>
            <X size={25} color="$uiNeutralSecondary" />
          </Pressable>
        </View>
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
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
    </ModalSheet>
  );
}
