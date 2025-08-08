import { PowerOff } from "@tamagui/lucide-icons";
import React from "react";
import { ScrollView, YStack } from "tamagui";

import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function DisconnectSheet({
  open,
  onClose,
  name,
  onActionPress,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  onActionPress: () => void;
}) {
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <SafeView
        paddingTop={0}
        fullScreen
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
      >
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <View fullScreen flex={1}>
            <YStack flex={1} paddingHorizontal="$s5" paddingVertical="$s7" gap="$s7">
              <YStack gap="$s4">
                <Text primary emphasized headline>
                  Are you sure you want to disconnect from {name}?
                </Text>
                <Text secondary subHeadline>
                  You can reconnect at any time.
                </Text>
              </YStack>
              <YStack gap="$s5">
                <Button onPress={onActionPress} dangerSecondary>
                  <Button.Text>Disconnect from {name}</Button.Text>
                  <Button.Icon>
                    <PowerOff />
                  </Button.Icon>
                </Button>
                <Text
                  cursor="pointer"
                  onPress={onClose}
                  emphasized
                  footnote
                  color="$interactiveBaseBrandDefault"
                  textAlign="center"
                >
                  Stay connected
                </Text>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}
