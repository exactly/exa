import React, { useRef } from "react";
import { useTranslation } from "react-i18next";

import { YStack } from "tamagui";

import OnHidden from "./OnHidden";
import { Headphones } from "../../generated/icons/Headphones";
import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function Unavailable({
  open,
  onClose,
  message,
}: {
  message?: string;
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  const messageRef = useRef<null | string>(null);
  return (
    <ModalSheet open={open} onClose={onClose}>
      <YStack gap="s7" borderTopLeftRadius="r5" borderTopRightRadius="r5" backgroundColor="backgroundSoft">
        <YStack gap="s5" paddingTop="s7" paddingHorizontal="s5">
          <Text emphasized headline>
            {t("Your Exa Card is unavailable")}
          </Text>
          <Text subHeadline color="uiNeutralSecondary">
            {t("Contact our support team for more details.")}
          </Text>
        </YStack>
        <YStack gap="s5" paddingHorizontal="s5" paddingBottom="s7">
          <Button
            primary
            width="100%"
            onPress={() => {
              messageRef.current = message ?? t("Hi! My Exa Card is unavailable. Could you tell me more?");
              onClose();
            }}
          >
            <Button.Text>{t("Contact support")}</Button.Text>
            <Button.Icon>
              <Headphones />
            </Button.Icon>
          </Button>
        </YStack>
      </YStack>
      <OnHidden message={messageRef} />
    </ModalSheet>
  );
}
