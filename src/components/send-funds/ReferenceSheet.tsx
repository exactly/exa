import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ThumbsUp } from "@tamagui/lucide-icons";
import { YStack } from "tamagui";

import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function ReferenceSheet({
  currency,
  provider,
  onClose,
  open,
}: {
  currency: string;
  onClose: () => void;
  open: boolean;
  provider: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <YStack
        gap="$s7"
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s5" paddingTop="$s7" paddingHorizontal="$s5">
          <Text emphasized headline>
            {t("Reference")}
          </Text>
          <Text subHeadline color="$uiNeutralSecondary">
            {t(
              "The reference is saved with this contact. To use a different one, delete the contact and add it again.",
            )}
          </Text>
        </YStack>
        <YStack gap="$s4" paddingHorizontal="$s5" paddingBottom="$s7">
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
            color="$interactiveTextBrandDefault"
            cursor="pointer"
            pressStyle={{ opacity: 0.7 }}
            onPress={() => {
              onClose();
              router.replace({ pathname: "/send-funds/recipients", params: { currency, provider } });
            }}
          >
            {t("Go to contacts")}
          </Text>
        </YStack>
      </YStack>
    </ModalSheet>
  );
}
