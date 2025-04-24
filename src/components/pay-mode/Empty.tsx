import React from "react";
import { StyleSheet } from "react-native";
import { YStack } from "tamagui";

import Blob from "../../assets/images/exa-card-blob.svg";
import ExaCard from "../../assets/images/exa-card.svg";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Empty() {
  return (
    <View fullScreen padding="$s5" alignItems="center" justifyContent="center" backgroundColor="$backgroundSoft">
      <YStack gap="$s6" alignItems="center" justifyContent="center">
        <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
          <View width="100%" height="100%">
            <Blob width="100%" height="100%" />
          </View>
          <View width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
            <ExaCard width="100%" height="100%" />
          </View>
        </View>
        <YStack alignItems="center" justifyContent="center" gap="$s6">
          <Text emphasized title color="$interactiveTextBrandDefault" textAlign="center">
            No payments pending
          </Text>
          <Text footnote secondary textAlign="center">
            You&apos;re all caught up! Start using your card to see payments listed here.
          </Text>
        </YStack>
      </YStack>
    </View>
  );
}
