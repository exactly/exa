import { ArrowRight } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React from "react";
import { StyleSheet } from "react-native";

import AccountCreatedBlob from "../../assets/images/account-created-blob.svg";
import AccountCreatedImage from "../../assets/images/account-created.svg";
import ActionButton from "../shared/ActionButton";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Success() {
  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View fullScreen padded>
        <View justifyContent="center" alignItems="center" flexGrow={1} flexShrink={1}>
          <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center" flexShrink={1}>
            <View width="100%" height="100%" aspectRatio={1}>
              <AccountCreatedBlob width="100%" height="100%" />
            </View>
            <View width="100%" height="100%" aspectRatio={1} style={StyleSheet.absoluteFill}>
              <AccountCreatedImage width="100%" height="100%" />
            </View>
          </View>
          <View gap="$s5" justifyContent="center">
            <Text emphasized title brand centered>
              Account created successfully!
            </Text>
          </View>
        </View>
        <View>
          <View flexDirection="row" alignSelf="stretch">
            <ActionButton
              flex={1}
              marginTop="$s4"
              marginBottom="$s5"
              onPress={() => {
                router.replace("/(app)/(home)");
              }}
              iconAfter={<ArrowRight color="$interactiveOnBaseBrandDefault" />}
            >
              Get started
            </ActionButton>
          </View>
        </View>
      </View>
    </SafeView>
  );
}
