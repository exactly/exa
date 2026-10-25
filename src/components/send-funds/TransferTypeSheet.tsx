import React from "react";
import { useTranslation } from "react-i18next";

import { ThumbsUp } from "@tamagui/lucide-icons-2/icons/ThumbsUp";
import { YStack } from "tamagui";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function TransferTypeSheet({ onClose, open }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <YStack gap="s7" borderTopLeftRadius="r5" borderTopRightRadius="r5" backgroundColor="backgroundSoft">
        <YStack gap="s5" paddingTop="s7" paddingHorizontal="s5">
          <Text emphasized headline>
            {t("Transfer type")}
          </Text>
          <Text subHeadline color="uiNeutralSecondary">
            {t("How your money is sent. ACH costs less, wire arrives sooner.")}
          </Text>
          <Text subHeadline color="uiNeutralSecondary">
            {t(
              "The bank may use a different transfer type than the one you choose, which can change when your money arrives.",
            )}
          </Text>
        </YStack>
        <YStack gap="s4" paddingHorizontal="s5">
          <Button primary width="100%" onPress={onClose}>
            <Button.Text>{t("Got it!")}</Button.Text>
            <Button.Icon>
              <ThumbsUp />
            </Button.Icon>
          </Button>
          <Text
            emphasized
            footnote
            textAlign="center"
            color="interactiveTextBrandDefault"
            cursor="pointer"
            opacity="press:0.7"
            onPress={() => {
              presentArticle("14093183").catch(reportError);
            }}
          >
            {t("Learn more")}
          </Text>
        </YStack>
      </YStack>
    </ModalSheet>
  );
}
