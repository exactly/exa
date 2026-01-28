import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { setStringAsync } from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, CalendarDays, Copy, Info, Percent, Repeat, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import reportError from "../../utils/reportError";
import { getRampQuote, type RampProvider } from "../../utils/server";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { MantecaCurrency } from "@exactly/server/utils/ramps/manteca"; // eslint-disable-line @nx/enforce-module-boundaries

export default function RampDetails() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const parameters = useLocalSearchParams<{ currency: (typeof MantecaCurrency)[number]; provider: RampProvider }>();

  const { provider, currency } = parameters;

  function copyToClipboard(text: string) {
    setStringAsync(text).catch(reportError);
    toast.show(t("Copied!"), { native: true, duration: 1000, burntOptions: { haptic: "success" } });
  }

  const { data, isPending } = useQuery({
    queryKey: ["ramp", "quote", provider, currency],
    queryFn: () => getRampQuote({ provider: "manteca", currency }),
  });

  const depositInfo = data?.depositInfo[0];
  const quote = data?.quote;

  function handleClose() {
    router.replace("/(main)/(home)");
  }

  function getDepositAddress() {
    if (!depositInfo) return "";
    if (depositInfo.network === "ARG_FIAT_TRANSFER") return depositInfo.cbu;
    if (depositInfo.network === "PIX") return depositInfo.pixKey;
    return "";
  }

  function getDepositAlias() {
    if (!depositInfo) return;
    if (depositInfo.network === "ARG_FIAT_TRANSFER") return depositInfo.depositAlias;
  }

  return (
    <SafeView fullScreen>
      <View gap={20} fullScreen padded>
        <View gap={20}>
          <View flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
            <Pressable
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(main)/(home)");
                }
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
            <Text fontSize={15} fontWeight="bold">
              {t("Details")}
            </Text>
            <Pressable>
              <Info color="$uiNeutralPrimary" />
            </Pressable>
          </View>
        </View>
        <ScrollView flex={1}>
          <View flex={1} gap={20}>
            <YStack flex={1} padding="$s4" gap="$s6">
              <YStack gap="$s4" alignSelf="center">
                <Text emphasized title3>
                  {t("Account details")}
                </Text>
                <Text color="$uiNeutralPlaceholder" subHeadline>
                  {t("Copy and share your account details to turn {{currency}} transfers into USDC.", { currency })}
                </Text>
              </YStack>
              <YStack gap="$s4" backgroundColor="$backgroundSoft" padding="$s4_5" borderRadius="$r3">
                <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                  <YStack>
                    <Text emphasized secondary footnote>
                      {t("Beneficiary name")}
                    </Text>
                    {isPending || !depositInfo ? (
                      <Text emphasized secondary footnote>
                        {t("Loading...")}
                      </Text>
                    ) : (
                      <Text emphasized secondary footnote>
                        {"beneficiaryName" in depositInfo ? depositInfo.beneficiaryName : ""}
                      </Text>
                    )}
                  </YStack>
                  <Pressable
                    onPress={() => {
                      if (depositInfo && "beneficiaryName" in depositInfo) copyToClipboard(depositInfo.beneficiaryName);
                    }}
                  >
                    <Copy size={24} color="$uiNeutralPrimary" />
                  </Pressable>
                </XStack>
                <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                  <YStack>
                    <Text emphasized secondary footnote>
                      {depositInfo?.displayName ?? t("Account")}
                    </Text>
                    {isPending || !depositInfo ? (
                      <Text emphasized secondary footnote>
                        {t("Loading...")}
                      </Text>
                    ) : (
                      <Text emphasized secondary footnote>
                        {getDepositAddress()}
                      </Text>
                    )}
                  </YStack>
                  <Pressable onPress={() => copyToClipboard(getDepositAddress())}>
                    <Copy size={24} color="$uiNeutralPrimary" />
                  </Pressable>
                </XStack>
                {getDepositAlias() && (
                  <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                    <YStack>
                      <Text emphasized secondary footnote>
                        {t("Deposit alias")}
                      </Text>
                      <Text emphasized secondary footnote>
                        {getDepositAlias()}
                      </Text>
                    </YStack>
                    <Pressable onPress={() => copyToClipboard(getDepositAlias() ?? "")}>
                      <Copy size={24} color="$uiNeutralPrimary" />
                    </Pressable>
                  </XStack>
                )}
              </YStack>
            </YStack>
          </View>
        </ScrollView>
        <YStack gap="$s4" padding="$s4">
          <Separator height={1} borderColor="$borderNeutralSoft" />
          <YStack gap="$s1" padding="$s4_5">
            <XStack gap="$s3" alignItems="center">
              <CalendarDays size={24} color="$uiNeutralPrimary" />
              <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                {t("Delivery time")}
              </Text>
              <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                {depositInfo?.estimatedProcessingTime ?? t("1 business day")}
              </Text>
            </XStack>
            <XStack gap="$s3" alignItems="center">
              <Repeat size={24} color="$uiNeutralPrimary" />
              <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                {t("Exchange rate")}
              </Text>
              <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                {quote?.buyRate ? `${currency} ${quote.buyRate} ~ US$ 1` : t("Loading...")}
              </Text>
            </XStack>
            <XStack gap="$s3" alignItems="center">
              <Percent size={24} color="$uiNeutralPrimary" />
              <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                {t("Fee")}
              </Text>
              <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                {depositInfo?.fee ?? t("Loading...")}
              </Text>
            </XStack>
          </YStack>
          <Button onPress={handleClose} primary>
            <Button.Text>{t("Close")}</Button.Text>
            <Button.Icon>
              <X />
            </Button.Icon>
          </Button>
        </YStack>
      </View>
    </SafeView>
  );
}
