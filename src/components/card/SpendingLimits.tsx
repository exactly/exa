import { Plus } from "@tamagui/lucide-icons";
import React from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import { ScrollView, Sheet, YStack } from "tamagui";

import SpendingLimit from "./SpendingLimit";
import reportError from "../../utils/reportError";
import useAspectRatio from "../../utils/useAspectRatio";
import useIntercom from "../../utils/useIntercom";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function SpendingLimits({ open, onClose }: { open: boolean; onClose: () => void }) {
  const aspectRatio = useAspectRatio();
  const { newMessage } = useIntercom();

  function handleSupport() {
    newMessage("I want to increase my spending limit").catch(reportError);
  }

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
                    <SpendingLimit title="Weekly" limit={10_000} />
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
      </Sheet.Frame>
    </Sheet>
  );
}

const styles = StyleSheet.create({ close: { alignSelf: "center" } });
