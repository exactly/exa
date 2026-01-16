import React from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

import { setStringAsync } from "expo-clipboard";

import { XStack } from "tamagui";

import shortenHex from "@exactly/common/shortenHex";

import reportError from "../../utils/reportError";
import Blocky from "../shared/Blocky";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Address } from "@exactly/common/validation";

export default function Contact({
  contact: { address, ens },
  onContactPress,
}: {
  contact: { address: Address; ens: string };
  onContactPress: (address: Address) => void;
}) {
  const { t } = useTranslation();
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
        Alert.alert(t("Address copied"), t("The contact's address has been copied to the clipboard."));
      }}
    >
      <XStack alignItems="center" gap="$s2">
        <View borderRadius="$r_0" overflow="hidden">
          <Blocky seed={address} size={8} scale={6} />
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
