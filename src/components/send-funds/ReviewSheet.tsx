import shortenHex from "@exactly/common/shortenHex";
import type { Address } from "@exactly/common/validation";
import { ArrowRight } from "@tamagui/lucide-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";

import assetLogos from "../../utils/assetLogos";
import AssetLogo from "../shared/AssetLogo";
import Blocky from "../shared/Blocky";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ReviewSheet({
  amount,
  external,
  isFirstSend,
  logoURI,
  onClose,
  onSend,
  open,
  receiver,
  sendReady,
  symbol,
  usdValue,
}: {
  amount: string;
  external: boolean;
  isFirstSend: boolean;
  logoURI?: string;
  onClose: () => void;
  onSend: () => void;
  open: boolean;
  receiver?: Address;
  sendReady: boolean;
  symbol?: string;
  usdValue: string;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <ScrollView $platform-web={{ maxHeight: "100vh" }}>
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
              <Text emphasized primary headline textAlign="center">
                {t("Review transaction")}
              </Text>
            </YStack>
            <YStack gap="$s3_5">
              <YStack gap="$s4">
                <Text emphasized footnote color="$uiNeutralSecondary">
                  {t("Sending")}
                </Text>
                <XStack alignItems="center" gap="$s3">
                  <AssetLogo
                    height={40}
                    source={{
                      uri: external ? logoURI : symbol ? assetLogos[symbol as keyof typeof assetLogos] : undefined,
                    }}
                    width={40}
                  />
                  <YStack flex={1}>
                    <Text title color="$uiNeutralPrimary">
                      {amount} {symbol}
                    </Text>
                    <Text subHeadline color="$uiNeutralSecondary">
                      {Number(usdValue).toLocaleString(language, {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Text>
                  </YStack>
                </XStack>
              </YStack>
              <YStack gap="$s4">
                <Text emphasized footnote color="$uiNeutralSecondary">
                  {t("To")}
                </Text>
                <XStack alignItems="center" gap="$s3">
                  <View borderRadius="$r_0" overflow="hidden">
                    <Blocky seed={receiver ?? zeroAddress} scale={5} />
                  </View>
                  <YStack>
                    <Text title color="$uiNeutralPrimary" fontFamily="$mono">
                      {shortenHex(receiver ?? "", 3, 5)}
                    </Text>
                    {receiver && isFirstSend && (
                      <Text subHeadline color="$uiNeutralSecondary">
                        {t("First time send")}
                      </Text>
                    )}
                  </YStack>
                </XStack>
              </YStack>
            </YStack>
            <YStack gap="$s5">
              <Button primary disabled={!sendReady} onPress={onSend}>
                <Button.Text>{sendReady ? t("Send") : t("Simulation failed")}</Button.Text>
                <Button.Icon>
                  <ArrowRight size={24} />
                </Button.Icon>
              </Button>
              <Pressable onPress={onClose}>
                <Text emphasized footnote color="$interactiveBaseBrandDefault" alignSelf="center">
                  {t("Close")}
                </Text>
              </Pressable>
            </YStack>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}
