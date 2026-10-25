import React from "react";

import { ScrollView, YStack } from "tamagui";

import ModalSheet from "./ModalSheet";
import SafeView from "./SafeView";
import Text from "./Text";
import View from "./View";

export default function InfoSheet({
  children,
  onClose,
  open,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  return (
    <ModalSheet open={open} onClose={onClose} backgroundColor="backgroundMild">
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="r4" borderTopRightRadius="r4">
        <ScrollView maxHeight="web:100vh">
          <View fullScreen flex={1}>
            <YStack flex={1} paddingHorizontal="s4" paddingTop="s4" gap="s4">
              <Text headline emphasized>
                {title}
              </Text>
              {children}
            </YStack>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}
