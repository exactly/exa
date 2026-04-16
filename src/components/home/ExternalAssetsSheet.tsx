import React from "react";
import { useTranslation } from "react-i18next";

import { ThumbsUp } from "@tamagui/lucide-icons";
import { YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import Button from "../shared/Button";
import ModalSheet from "../shared/ModalSheet";
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
          <Button
            onPress={onClose}
            contained
            main
            spaced
            fullwidth
            iconAfter={<ThumbsUp strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
          >
            {t("Got it!")}
          </Button>
        </YStack>
      </YStack>
    </ModalSheet>
  );
}
