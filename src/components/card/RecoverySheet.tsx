import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { YStack } from "tamagui";

import { Headphones } from "../../generated/icons/Headphones";
import { newMessage } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function RecoverySheet({ open, onClose }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation();
  const messageRef = useRef<null | string>(null);
  return (
    <ModalSheet open={open} onClose={onClose}>
      <YStack gap="s7" borderTopLeftRadius="r5" borderTopRightRadius="r5" backgroundColor="backgroundSoft">
        <YStack gap="s5" paddingTop="s7" paddingHorizontal="s5">
          <Text emphasized headline>
            {t("Your card needs a quick check")}
          </Text>
          <Text subHeadline color="uiNeutralSecondary">
            {t("Reach out to our support team and we’ll get you back on track.")}
          </Text>
        </YStack>
        <YStack gap="s5" paddingHorizontal="s5" paddingBottom="s7">
          <Button
            primary
            width="100%"
            onPress={() => {
              messageRef.current = t("Hi! My Exa Card activation needs a support check. Can you help me?");
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

function OnHidden({ message }: { message: { current: null | string } }) {
  useEffect(() => {
    return () => {
      const text = message.current;
      if (text === null) return;
      message.current = null;
      newMessage(text).catch(reportError);
    };
  }, [message]);
  return null;
}
