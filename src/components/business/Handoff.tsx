import React from "react";
import { useTranslation } from "react-i18next";

import { ArrowUpRight } from "@tamagui/lucide-icons-2";
import { YStack } from "tamagui";

import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function Handoff({
  open,
  onClose,
  onContinue,
}: {
  onClose: () => void;
  onContinue: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose}>
      <YStack
        gap="$s7"
        padding="$s5"
        paddingTop="$s7"
        paddingBottom="$s7"
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
      >
        <YStack gap="$s4">
          <Text emphasized headline>
            {t("Continue verification")}
          </Text>
          <Text subHeadline color="$uiNeutralSecondary">
            {t("We'll open a new tab to finish your verification. Come back here when you're done.")}
          </Text>
        </YStack>
        <Button primary onPress={onContinue}>
          <Button.Text>{t("Continue")}</Button.Text>
          <Button.Icon>
            <ArrowUpRight />
          </Button.Icon>
        </Button>
      </YStack>
    </ModalSheet>
  );
}
