import { Plus } from "@tamagui/lucide-icons";
import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { ScrollView, YStack } from "tamagui";

import SpendingLimit from "./SpendingLimit";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function SpendingLimits({
  open,
  onClose,
  totalSpent,
  limit,
}: {
  open: boolean;
  onClose: () => void;
  totalSpent: number;
  limit?: number;
}) {
  const { newMessage } = useIntercom();
  function handleSupport() {
    newMessage("I want to increase my spending limit").catch(reportError);
  }
  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <View fullScreen flex={1}>
            <View flex={1} padded>
              <YStack gap="$s4_5">
                <YStack gap="$s4">
                  <Text emphasized headline primary>
                    Spending limits
                  </Text>
                  <Text color="$uiNeutralSecondary" subHeadline>
                    Track your spending and see how much you&apos;ve spent with your Exa Card so far.
                  </Text>
                </YStack>
                <YStack paddingBottom="$s4">
                  <SpendingLimit title="Weekly" limit={limit} totalSpent={totalSpent} />
                </YStack>
                <Button onPress={handleSupport} primary>
                  <Button.Text>Increase spending limit</Button.Text>
                  <Button.Icon>
                    <Plus />
                  </Button.Icon>
                </Button>
                <Pressable onPress={onClose} style={styles.close} hitSlop={20}>
                  <Text emphasized footnote color="$interactiveTextBrandDefault">
                    Close
                  </Text>
                </Pressable>
              </YStack>
            </View>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({ close: { alignSelf: "center" } });
