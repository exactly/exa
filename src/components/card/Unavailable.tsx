import React, { useRef } from "react";
import { useTranslation } from "react-i18next";

import { YStack } from "tamagui";

import OnHidden from "./OnHidden";
import { Headphones } from "../../generated/icons/Headphones";
import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function Unavailable({ open, onClose }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation();
  const messageRef = useRef<null | string>(null);
  return (
    <ModalSheet open={open} onClose={onClose}>
      <YStack gap="s7" borderTopLeftRadius="r5" borderTopRightRadius="r5" backgroundColor="backgroundSoft">
        <YStack gap="s5" paddingTop="s7" paddingHorizontal="s5">
          <Text emphasized headline>
            {t("We can’t issue your card yet")}
          </Text>
          <Text subHeadline color="uiNeutralSecondary">
            {t("Our support team needs to check your account before issuing a card.")}
          </Text>
        </YStack>
        <YStack gap="s5" paddingHorizontal="s5" paddingBottom="s7">
          <Button
            primary
            width="100%"
            onPress={() => {
              messageRef.current = t("Hi! I can’t get an Exa Card. Could you check my account?");
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
