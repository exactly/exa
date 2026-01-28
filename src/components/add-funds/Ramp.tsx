import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { setStringAsync } from "expo-clipboard";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, CalendarDays, Copy, Info, Percent, Repeat, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import { isValidCurrency, type Currency } from "../../utils/currencies";
import reportError from "../../utils/reportError";
import { getRampQuote } from "../../utils/server";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

type DetailRowProperties = {
  isLoading: boolean;
  label: string;
  onCopy: () => void;
  value: string | undefined;
};

function DetailRow({ label, value, isLoading, onCopy }: DetailRowProperties) {
  const { t } = useTranslation();

  return (
    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
      <YStack>
        <Text emphasized secondary footnote>
          {label}
        </Text>
        <Text emphasized secondary footnote>
          {isLoading ? t("Loading...") : (value ?? "")}
        </Text>
      </YStack>
      <Pressable disabled={isLoading || !value} onPress={onCopy}>
        <Copy size={24} color="$uiNeutralPrimary" />
      </Pressable>
    </XStack>
  );
}

export default function Ramp() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const { currency } = useLocalSearchParams<{ currency: string }>();

  const validCurrency = isValidCurrency(currency);

  const { data, isPending } = useQuery({
    queryKey: ["ramp", "quote", "manteca", currency],
    queryFn: () => getRampQuote({ provider: "manteca", currency: currency as Currency }),
    enabled: validCurrency,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  if (!validCurrency) return <Redirect href="/add-funds" />;

  const depositInfo = data?.depositInfo[0];
  const quote = data?.quote;

  const beneficiaryName = depositInfo && "beneficiaryName" in depositInfo ? depositInfo.beneficiaryName : undefined;
  const depositAddress =
    depositInfo?.network === "ARG_FIAT_TRANSFER"
      ? depositInfo.cbu
      : depositInfo?.network === "PIX"
        ? depositInfo.pixKey
        : undefined;
  const depositAlias = depositInfo?.network === "ARG_FIAT_TRANSFER" ? depositInfo.depositAlias : undefined;

  function copyToClipboard(text: string) {
    setStringAsync(text).catch(reportError);
    toast.show(t("Copied!"), { native: true, duration: 1000, burntOptions: { haptic: "success" } });
  }

  function handleClose() {
    router.replace("/(main)/(home)");
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
            <Pressable hitSlop={15}>
              <Info size={16} color="$uiNeutralPrimary" />
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
                <DetailRow
                  label={t("Beneficiary name")}
                  value={beneficiaryName}
                  isLoading={isPending}
                  onCopy={() => beneficiaryName && copyToClipboard(beneficiaryName)}
                />
                <DetailRow
                  label={depositInfo?.displayName ?? t("Account")}
                  value={depositAddress}
                  isLoading={isPending}
                  onCopy={() => depositAddress && copyToClipboard(depositAddress)}
                />
                {depositAlias && (
                  <DetailRow
                    label={t("Deposit alias")}
                    value={depositAlias}
                    isLoading={isPending}
                    onCopy={() => copyToClipboard(depositAlias)}
                  />
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
