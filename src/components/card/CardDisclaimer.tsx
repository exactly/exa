import { ArrowRight, X } from "@tamagui/lucide-icons";
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { ScrollView, YStack } from "tamagui";

import Blob from "../../assets/images/exa-card-blob.svg";
import ExaCard from "../../assets/images/exa-card.svg";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import ModalSheet from "../shared/ModalSheet";
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
  const { presentArticle } = useIntercom();
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
                  agreement with Exactly Protocol and is not responsible for any funding or credit arrangement between
                  user and Exactly Protocol.
                </Text>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}
