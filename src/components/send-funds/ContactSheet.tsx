import React from "react";
import { useTranslation } from "react-i18next";

import { Check } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import Blocky from "../shared/Blocky";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Address } from "@exactly/common/validation";

export default function ContactSheet({
  contact,
  onClose,
  onDelete,
}: {
  contact?: { address: Address; ens: string };
  onClose: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={!!contact} onClose={onClose}>
      <SafeView
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        paddingHorizontal="$s5"
        paddingTop="$s7"
        $platform-web={{ paddingVertical: "$s7" }}
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s5">
          <Text emphasized headline primary>
            {t("Edit contact")}
          </Text>
          {contact && (
            <XStack gap="$s3" alignItems="center">
              <View borderRadius="$r_0" overflow="hidden">
                <Blocky seed={contact.address} />
              </View>
              <YStack gap="$s2" flex={1}>
                {!!contact.ens && (
                  <Text title3 primary>
                    {contact.ens}
                  </Text>
                )}
                <Text footnote secondary mono>
                  {contact.address}
                </Text>
              </YStack>
            </XStack>
          )}
          <YStack gap="$s4_5" paddingTop="$s3_5">
            <Button primary onPress={onClose}>
              <Button.Text>{t("Done")}</Button.Text>
              <Button.Icon>
                <Check size={20} />
              </Button.Icon>
            </Button>
            <Text
              emphasized
              footnote
              textAlign="center"
              color="$uiErrorSecondary"
              cursor="pointer"
              pressStyle={{ opacity: 0.7 }}
              role="button"
              aria-label={t("Delete contact")}
              onPress={onDelete}
            >
              {t("Delete contact")}
            </Text>
          </YStack>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}
