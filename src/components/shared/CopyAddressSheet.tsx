import React from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle } from "@tamagui/lucide-icons-2/icons/AlertTriangle";
import { CheckCircle } from "@tamagui/lucide-icons-2/icons/CheckCircle";
import { X } from "@tamagui/lucide-icons-2/icons/X";
import { ScrollView, XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import ModalSheet from "./ModalSheet";
import SafeView from "./SafeView";
import Button from "./StyledButton";
import Text from "./Text";
import View from "./View";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";

export default function CopyAddressSheet({
  open,
  onClose,
  address: overrideAddress,
  asset,
  network,
}: {
  address?: string;
  asset?: string;
  network?: string;
  onClose: () => void;
  open: boolean;
}) {
  const { address: accountAddress } = useAccount();
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <ScrollView showsVerticalScrollIndicator={false} maxHeight="web:100vh">
        <SafeView
          borderTopLeftRadius="r4"
          borderTopRightRadius="r4"
          backgroundColor="backgroundSoft"
          paddingHorizontal="s5"
          paddingTop="web:s7"
          paddingBottom="web:s7 android:s5"
        >
          <YStack gap="s7">
            <YStack gap="s5">
              <XStack gap="s3" alignItems="center">
                <CheckCircle size={24} color="uiSuccessSecondary" />
                <Text emphasized headline color="uiSuccessSecondary">
                  {t("Address copied")}
                </Text>
              </XStack>
              <Text secondary subHeadline>
                {t("Double-check your address before sending funds to avoid losing them.")}
              </Text>
            </YStack>
            <Text mono primary title2 textAlign="center">
              {overrideAddress ?? accountAddress}
            </Text>
            <XStack
              gap="s4"
              alignItems="flex-start"
              borderTopWidth={1}
              borderTopColor="borderNeutralSoft"
              paddingTop="s4_5"
            >
              <View>
                <AlertTriangle size={16} width={16} height={16} color="uiWarningSecondary" />
              </View>
              <XStack flex={1}>
                <Text caption2 color="uiNeutralPlaceholder">
                  {asset
                    ? t(
                        "Only send {{crypto}} on {{network}}. Sending other assets or using other networks may cause permanent loss.",
                        { crypto: asset, network: network ?? chain.name },
                      )
                    : t("Only send assets on {{chain}}. Sending funds from other networks may cause permanent loss.", {
                        chain: network ?? chain.name,
                      })}
                  <Text
                    cursor="pointer"
                    color="uiBrandSecondary"
                    emphasized
                    caption2
                    onPress={() => {
                      presentArticle("8950801").catch(reportError);
                    }}
                  >
                    {" "}
                    {t("Learn more about adding funds.")}
                  </Text>
                </Text>
              </XStack>
            </XStack>
            <Button secondary width="100%" onPress={onClose}>
              <Button.Text>{t("Close")}</Button.Text>
              <Button.Icon>
                <X />
              </Button.Icon>
            </Button>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}
