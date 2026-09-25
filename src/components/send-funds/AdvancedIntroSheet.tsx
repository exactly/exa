import React from "react";
import { useTranslation } from "react-i18next";

import { ArrowRight } from "@tamagui/lucide-icons-2";
import { YStack } from "tamagui";

import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function AdvancedIntroSheet({
  open,
  onDismiss,
  onEnable,
}: {
  onDismiss: () => void;
  onEnable: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onDismiss}>
      <SafeView
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        paddingHorizontal="$s5"
        paddingTop="$s7"
        $platform-web={{ paddingVertical: "$s7" }}
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s5" alignItems="center">
          <Text
            pill
            caption2
            alignSelf="center"
            color="$interactiveOnBaseBrandDefault"
            backgroundColor="$interactiveBaseBrandDefault"
          >
            {t("NEW")}
          </Text>
          <Text emphasized title brand centered>
            {t("Send anything, anywhere")}
          </Text>
          <Text subHeadline secondary centered>
            {t(
              "Send Bitcoin using your USDC balance. Choose what your recipient gets, pick what you pay with, and we'll find the best route.",
            )}
          </Text>
          <YStack gap="$s4_5" paddingTop="$s3_5" alignSelf="stretch">
            <Button primary onPress={onEnable}>
              <Button.Text>{t("Turn it on")}</Button.Text>
              <Button.Icon>
                <ArrowRight size={20} />
              </Button.Icon>
            </Button>
            <Text
              emphasized
              subHeadline
              brand
              centered
              role="button"
              cursor="pointer"
              pressStyle={{ opacity: 0.7 }}
              onPress={onDismiss}
            >
              {t("Not now")}
            </Text>
          </YStack>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}
