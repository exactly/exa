import React from "react";
import { useTranslation } from "react-i18next";

import { ThumbsUp } from "@tamagui/lucide-icons";
import { YStack } from "tamagui";

import Button from "../shared/Button";
import ModalSheet from "../shared/ModalSheet";
import Text from "../shared/Text";

export default function CollateralAssetsSheet({ onClose, open }: { onClose: () => void; open: boolean }) {
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
            {t("Collateral assets")}
          </Text>
          <Text subHeadline color="$uiNeutralSecondary">
            {t(
              "Assets you can use as backing to increase your credit limit and access features like Pay Later or funding.",
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
