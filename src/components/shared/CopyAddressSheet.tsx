import React from "react";
import { useTranslation } from "react-i18next";

import { AlertTriangle, CheckCircle, X } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import ModalSheet from "./ModalSheet";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

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
  const networkName = network ?? chain.name;
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <ScrollView showsVerticalScrollIndicator={false} $platform-web={{ maxHeight: "100vh" }}>
        <SafeView
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundSoft"
          paddingHorizontal="$s5"
          $platform-web={{ paddingVertical: "$s7" }}
          $platform-android={{ paddingBottom: "$s5" }}
        >
          <YStack gap="$s7">
            <YStack gap="$s5">
              <XStack gap="$s3" alignItems="center">
                <CheckCircle size={24} color="$uiSuccessSecondary" />
                <Text emphasized headline color="$uiSuccessSecondary">
                  {t("Address copied")}
                </Text>
              </XStack>
              <Text secondary subHeadline>
                {t("Double-check your address before sending funds to avoid losing them.")}
              </Text>
            </YStack>
            <Text primary title2 textAlign="center">
              {overrideAddress ?? accountAddress}
            </Text>
            <XStack
              gap="$s4"
              alignItems="flex-start"
              borderTopWidth={1}
              borderTopColor="$borderNeutralSoft"
              paddingTop="$s4_5"
            >
              <View>
                <AlertTriangle size={16} width={16} height={16} color="$uiWarningSecondary" />
              </View>
              <XStack flex={1}>
                <Text caption2 color="$uiNeutralPlaceholder">
                  {asset
                    ? t(
                        "Only send {{crypto}} on {{network}}. Sending other assets or using other networks may cause permanent loss.",
                        { crypto: asset, network: networkName },
                      )
                    : t("Only send assets on {{chain}}. Sending funds from other networks may cause permanent loss.", {
                        chain: networkName,
                      })}
                  <Text
                    cursor="pointer"
                    emphasized
                    caption2
                    color="$uiBrandSecondary"
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
