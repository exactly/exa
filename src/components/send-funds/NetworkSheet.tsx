import React from "react";
import { useTranslation } from "react-i18next";

import { XStack, YStack } from "tamagui";

import ChainLogo from "../shared/ChainLogo";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function NetworkSheet({
  compatible,
  id,
  name,
  onClose,
  open,
}: {
  compatible?: boolean;
  id?: number;
  name?: string;
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
          <XStack gap="$s3_5" alignItems="center">
            <ChainLogo chainId={id} size={40} />
            <Text emphasized headline primary flexShrink={1}>
              {t("Network unavailable")}
            </Text>
          </XStack>
          <Text subHeadline secondary>
            {compatible
              ? t("Sending from {{network}} isn’t supported yet.", { network: name })
              : t("The address you entered doesn’t support the {{network}} network.", { network: name })}
          </Text>
          <YStack paddingTop="$s3_5">
            <Button primary onPress={onClose}>
              <Button.Text>{t("Close")}</Button.Text>
            </Button>
          </YStack>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}
