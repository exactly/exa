import React from "react";
import { useTranslation } from "react-i18next";

import { Separator, XStack, YStack } from "tamagui";

import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Switch from "../shared/Switch";
import Text from "../shared/Text";

export default function AdvancedSheet({
  advanced,
  open,
  onChange,
  onClose,
}: {
  advanced: boolean;
  onChange: (enabled: boolean) => void;
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose}>
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
          <XStack
            gap="$s4"
            alignItems="center"
            justifyContent="space-between"
            cursor="pointer"
            role="switch"
            aria-label={t("Advanced mode")}
            aria-checked={advanced}
            pressStyle={{ opacity: 0.7 }}
            onPress={() => {
              onChange(!advanced);
            }}
          >
            <Text emphasized headline primary>
              {t("Advanced mode")}
            </Text>
            <Switch checked={advanced}>
              <Switch.Thumb />
            </Switch>
          </XStack>
          <Separator borderColor="$borderNeutralSoft" />
          <Text subHeadline secondary>
            {t(
              "Send any asset to any network, even ones you don't hold. We'll handle the swap or bridge and show the full cost before you confirm.",
            )}
          </Text>
          <Text
            emphasized
            subHeadline
            brand
            centered
            paddingTop="$s3_5"
            role="button"
            cursor="pointer"
            pressStyle={{ opacity: 0.7 }}
            onPress={onClose}
          >
            {t("Close")}
          </Text>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}
