import { ArrowRight, X } from "@tamagui/lucide-icons";
import React from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import { ScrollView, Sheet, YStack } from "tamagui";

import Blob from "../../assets/images/exa-card-blob.svg";
import ExaCard from "../../assets/images/exa-card.svg";
import reportError from "../../utils/reportError";
import useAspectRatio from "../../utils/useAspectRatio";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function CardDisclaimer({
  open,
  onClose,
  onActionPress,
}: {
  open: boolean;
  onClose: () => void;
  onActionPress: () => void;
}) {
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
          <View position="absolute" top="$s5" right="$s5" zIndex={100_000}>
            <Pressable onPress={onClose} hitSlop={15}>
              <X size={25} color="$uiNeutralSecondary" />
            </Pressable>
          </View>
          <ScrollView>
            <View fullScreen flex={1}>
              <YStack flex={1} padding="$s4" gap="$s6">
                <YStack flex={1} justifyContent="center" gap="$s4">
                  <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
                    <View width="100%" height="100%">
                      <Blob width="100%" height="100%" />
                    </View>
                    <View width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
                      <ExaCard width="100%" height="100%" />
                    </View>
                  </View>
                  <Text emphasized textAlign="center" color="$interactiveTextBrandDefault" title>
                    Activate your new Exa Card*
                  </Text>
                </YStack>
                <YStack gap="$s4_5">
                  <YStack gap="$s4">
                    <Pressable
                      onPress={() => {
                        presentArticle("10707672").catch(reportError);
                      }}
                    >
                      <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                        By continuing, you agree to both, the disclaimer below and the Exa Card&nbsp;
                        <Text color="$interactiveTextBrandDefault" footnote>
                          Terms & Conditions.
                        </Text>
                      </Text>
                    </Pressable>
                    <Button
                      flexBasis={60}
                      onPress={onActionPress}
                      contained
                      main
                      spaced
                      fullwidth
                      iconAfter={<ArrowRight strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
                    >
                      Accept and enable card
                    </Button>
                  </YStack>
                  <Text color="$interactiveOnDisabled" caption textAlign="justify">
                    *The Exa Card is issued by Third National pursuant to a license from Visa. Any credit issued by
                    Exactly Protocol subject to its separate terms and conditions. Third National is not a party to any
                    agreement with Exactly Protocol and is not responsible for any loan or credit arrangement between
                    user and Exactly Protocol.
                  </Text>
                </YStack>
              </YStack>
            </View>
          </ScrollView>
        </SafeView>
      </Sheet.Frame>
    </Sheet>
  );
}
