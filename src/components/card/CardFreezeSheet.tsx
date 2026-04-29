import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Snowflake } from "@tamagui/lucide-icons";
import { YStack } from "tamagui";

import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function CardFreezeSheet({
  onClose,
  onConfirm,
  open,
}: {
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose}>
      <YStack
        gap="$s7"
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s4" paddingTop="$s5" paddingHorizontal="$s5">
          <Text emphasized headline>
            {t("Freeze your card?")}
          </Text>
          <Text subHeadline secondary>
            {t("Your card will be temporarily paused. You can unfreeze it anytime.")}
          </Text>
        </YStack>
        <YStack gap="$s4" paddingHorizontal="$s4" paddingBottom="$s7">
          <Button primary onPress={onConfirm}>
            <Button.Text>{t("Freeze card")}</Button.Text>
            <Button.Icon>
              <Snowflake strokeWidth={2.5} />
            </Button.Icon>
          </Button>
          <Pressable onPress={onClose}>
            <Text emphasized footnote color="$interactiveBaseBrandDefault" alignSelf="center">
              {t("Cancel")}
            </Text>
          </Pressable>
        </YStack>
      </YStack>
    </ModalSheet>
  );
}
