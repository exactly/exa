import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { CalendarDays, ExternalLink, X, Zap } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import Button from "../shared/Button";
import ModalSheet from "../shared/ModalSheet";
import Text from "../shared/Text";

export default function PayModeSheet({ onClose, open }: { onClose: () => void; open: boolean }) {
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
        <YStack gap="$s5" paddingTop="$s5" paddingHorizontal="$s5">
          <YStack gap="$s4">
            <XStack justifyContent="space-between" alignItems="center" gap="$s3">
              <Text emphasized headline flex={1}>
                {t("Exa Card pay mode")}
              </Text>
              <Pressable hitSlop={15} onPress={onClose}>
                <X size={24} color="$uiNeutralPrimary" />
              </Pressable>
            </XStack>
            <Text subHeadline secondary>
              {t("Change the pay mode before each purchase and pay how you want.")}
            </Text>
          </YStack>
          <YStack gap="$s3_5">
            <YStack
              borderWidth={1}
              borderColor="$borderNeutralSoft"
              borderRadius="$r6"
              paddingTop="$s4"
              paddingHorizontal="$s4"
              paddingBottom="$s4_5"
              alignItems="center"
              gap="$s4"
            >
              <XStack
                backgroundColor="$cardDebitInteractive"
                borderRadius="$r_0"
                height={40}
                alignItems="center"
                justifyContent="center"
                gap="$s3"
                paddingHorizontal="$s4"
                width="100%"
              >
                <Zap size={20} color="$cardDebitText" />
                <Text subHeadline emphasized color="$cardDebitText">
                  {t("Now")}
                </Text>
              </XStack>
              <Text subHeadline secondary textAlign="center">
                {t("Pay instantly using your available USDC.")}
              </Text>
            </YStack>
            <YStack
              borderWidth={1}
              borderColor="$borderNeutralSoft"
              borderRadius="$r6"
              paddingTop="$s4"
              paddingHorizontal="$s4"
              paddingBottom="$s4_5"
              alignItems="center"
              gap="$s4"
            >
              <XStack
                backgroundColor="$cardCreditInteractive"
                borderRadius="$r_0"
                height={40}
                alignItems="center"
                justifyContent="center"
                gap="$s3"
                paddingHorizontal="$s4"
                width="100%"
              >
                <CalendarDays size={20} color="$cardCreditText" />
                <Text subHeadline emphasized color="$cardCreditText">
                  {t("Later")}
                </Text>
              </XStack>
              <Text subHeadline secondary textAlign="center">
                {t(
                  "Pay without selling your crypto. Use it as collateral to unlock a credit limit and split purchases into up to {{max}} installments.",
                  { max: MAX_INSTALLMENTS },
                )}
              </Text>
            </YStack>
          </YStack>
        </YStack>
        <YStack gap="$s5" paddingHorizontal="$s4" paddingBottom="$s7">
          <Button
            onPress={() => {
              presentArticle("9465994").catch(reportError);
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
