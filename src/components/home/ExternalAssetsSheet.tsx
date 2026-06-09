import React from "react";
import { useTranslation } from "react-i18next";

import { ThumbsUp } from "@tamagui/lucide-icons";
import { YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function ExternalAssetsSheet({ onClose, open }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation();
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
            {t("Non-collateral assets")}
          </Text>
          <Text subHeadline color="$uiNeutralSecondary">
            {t(
              "Assets you can hold, but they can't be used as backing. You can swap or bridge them to supported collateral assets on {{chain}} network to increase your credit limit.",
              { chain: chain.name },
            )}
          </Text>
        </YStack>
        <YStack paddingHorizontal="$s5" paddingBottom="$s7">
          <Button primary width="100%" onPress={onClose}>
            <Button.Text>{t("Got it!")}</Button.Text>
            <Button.Icon>
              <ThumbsUp />
            </Button.Icon>
          </Button>
        </YStack>
      </YStack>
    </ModalSheet>
  );
}
