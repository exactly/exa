import { ArrowLeft, Info } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView } from "tamagui";

import AddCryptoButton from "./AddCryptoButton";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

function back() {
  router.back();
}

export default function AddFunds() {
  const { canGoBack } = router;
  return (
    <SafeView fullScreen>
      <View gap={20} fullScreen padded>
        <View gap={20}>
          <View flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
            {canGoBack() && (
              <Pressable onPress={back}>
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            )}
            <Text fontSize={15} fontWeight="bold">
              Add Funds
            </Text>
            <Pressable>
              <Info color="$uiNeutralPrimary" />
            </Pressable>
          </View>
        </View>
        <ScrollView flex={1}>
          <View flex={1} gap={20}>
            <AddCryptoButton />
            <View flex={1}>
              <Text color="$uiNeutralPlaceholder" fontSize={13} textAlign="justify">
                Assets are added to your balance as collateral to increase your credit limit. You can change collateral
                preferences in your account.
                <Text color="$uiBrandSecondary" fontSize={13} fontWeight="bold">
                  &nbsp;Learn more about collateral.
                </Text>
              </Text>
            </View>
          </View>
        </ScrollView>
      </View>
    </SafeView>
  );
}
