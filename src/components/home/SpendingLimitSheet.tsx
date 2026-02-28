import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ExternalLink, X } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import Button from "../shared/Button";
import ModalSheet from "../shared/ModalSheet";
import Text from "../shared/Text";

export default function SpendingLimitSheet({ onClose, open }: { onClose: () => void; open: boolean }) {
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
        <YStack gap="$s4" paddingTop="$s5" paddingHorizontal="$s5">
          <YStack gap="$s4">
            <XStack justifyContent="space-between" alignItems="center" gap="$s3">
              <Text emphasized headline flex={1}>
                {t("Spending limit")}
              </Text>
              <Pressable hitSlop={15} onPress={onClose}>
                <X size={24} color="$uiNeutralPrimary" />
              </Pressable>
            </XStack>
            <YStack gap="$s4">
              <Text subHeadline secondary>
                <Trans
                  i18nKey="The maximum amount you can spend using <highlight>Pay Now</highlight>."
                  components={{ highlight: <Text subHeadline emphasized color="$cardDebitInteractive" /> }}
                />
              </Text>
              <Text subHeadline secondary>
                {t("It's based on the USDC available in your balance.")}
              </Text>
            </YStack>
          </YStack>
        </YStack>
        <YStack gap="$s5" paddingHorizontal="$s4" paddingBottom="$s7">
          <Button
            onPress={() => {
              presentArticle("9922633").catch(reportError);
            }}
            contained
            main
            spaced
            fullwidth
            iconAfter={<ExternalLink strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
          >
            {t("Learn more")}
          </Button>
          <Pressable onPress={onClose}>
            <Text emphasized footnote color="$interactiveBaseBrandDefault" alignSelf="center">
              {t("Close")}
            </Text>
          </Pressable>
        </YStack>
      </YStack>
    </ModalSheet>
  );
}
