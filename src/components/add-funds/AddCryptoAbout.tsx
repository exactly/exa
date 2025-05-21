import { X } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React from "react";

import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AddCryptoAbout() {
  return (
    <SafeView fullScreen paddingTop={0} backgroundColor="$backgroundSoft">
      <View fullScreen padded gap="$s4">
        <View gap={10} justifyContent="space-between" flex={1}>
          <View gap={10}>
            <Text fontSize={17} fontWeight="bold" textAlign="left">
              Adding funds
            </Text>
            <Text fontSize={16} color="$uiNeutralSecondary" textAlign="left">
              Your account is a self-custodial smart wallet on OP Mainnet. To fund your account, simply send any of the
              supported assets to your address.
            </Text>
            <Text fontSize={11} color="$uiNeutralSecondary" textAlign="left">
              Exa App runs on OP Mainnet Network. Sending assets on other networks may result in irreversible loss of
              funds.
            </Text>
          </View>
          <Button
            main
            outlined
            spaced
            iconAfter={<X size={20} color="$interactiveOnBaseBrandSoft" fontWeight="bold" />}
            onPress={() => {
              router.back();
            }}
          >
            Close
          </Button>
        </View>
      </View>
    </SafeView>
  );
}
