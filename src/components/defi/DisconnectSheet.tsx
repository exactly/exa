import { PowerOff } from "@tamagui/lucide-icons";
import React from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
                  {t("Are you sure you want to disconnect from {{name}}?", { name })}
                </Text>
                <Text secondary subHeadline>
                  {t("You can reconnect at any time.")}
                </Text>
              </YStack>
              <YStack gap="$s5">
                <Button onPress={onActionPress} dangerSecondary>
                  <Button.Text>{t("Disconnect from {{name}}", { name })}</Button.Text>
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
                  {t("Stay connected")}
                </Text>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}
