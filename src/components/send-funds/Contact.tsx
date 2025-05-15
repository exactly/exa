import shortenHex from "@exactly/common/shortenHex";
import type { Address } from "@exactly/common/validation";
import { User2 } from "@tamagui/lucide-icons";
import { setStringAsync } from "expo-clipboard";
import React from "react";
import { Alert } from "react-native";
import { XStack } from "tamagui";

import reportError from "../../utils/reportError";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Contact({
  contact: { address, ens },
  onContactPress,
}: {
  contact: { address: Address; ens: string };
  onContactPress: (address: Address) => void;
}) {
  return (
    <XStack
      borderRadius="$r3"
      justifyContent="space-between"
      alignItems="center"
      pressStyle={pressStyle}
      padding="$s2"
      onPress={() => {
        onContactPress(address);
      }}
      onLongPress={() => {
        setStringAsync(address).catch(reportError);
        Alert.alert("Address copied", "The contact's address has been copied to the clipboard.");
      }}
    >
      <XStack alignItems="center" gap="$s2">
        <View
          backgroundColor="$interactiveBaseBrandSoftDefault"
          padding="$s3_5"
          borderRadius="$r_0"
          justifyContent="center"
          alignItems="center"
        >
          <User2 color="$interactiveOnBaseBrandSoft" fontWeight="bold" />
        </View>
        {ens ? (
          <Text textAlign="right" subHeadline color="$uiNeutralSecondary">
            {ens}
          </Text>
        ) : null}
      </XStack>
      <Text textAlign="right" subHeadline color="$uiNeutralSecondary" fontFamily="$mono">
        {shortenHex(address)}
      </Text>
    </XStack>
  );
}

const pressStyle = { backgroundColor: "$uiNeutralTertiary", borderRadius: "$r3" };
