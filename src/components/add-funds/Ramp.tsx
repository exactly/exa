import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import QRCode from "react-native-qrcode-styled";

import { setStringAsync } from "expo-clipboard";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, Banknote, CalendarDays, Copy, Info, Percent, QrCode, Repeat } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import { createStatic } from "@pix.js/qrcode";
import { useQuery } from "@tanstack/react-query";

import MantecaDisclaimer from "./MantecaDisclaimer";
import { isValidCurrency } from "../../utils/currencies";
import reportError from "../../utils/reportError";
import { getRampProviders, getRampQuote } from "../../utils/server";
import Button from "../shared/Button";
import InfoAlert from "../shared/InfoAlert";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

type DetailRowProperties = {
  isLoading: boolean;
  label: string;
  onCopy: () => void;
  value: string | undefined;
};

function DetailRow({ label, value, isLoading, onCopy }: DetailRowProperties) {
  return (
    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
      <YStack>
        <Text emphasized secondary footnote>
          {label}
        </Text>
        <Text emphasized secondary footnote>
          {isLoading || !value ? <Skeleton width={100} height={16} /> : value}
        </Text>
      </YStack>
      <Pressable disabled={isLoading || !value} onPress={onCopy}>
        <Copy size={24} color={isLoading || !value ? "$uiNeutralPlaceholder" : "$interactiveBaseBrandDefault"} />
      </Pressable>
    </XStack>
  );
}

export default function Ramp() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const [qrSheetOpen, setQRSheetOpen] = useState(false);
  const { currency } = useLocalSearchParams<{ currency: string }>();

  const typedCurrency = isValidCurrency(currency) ? currency : undefined;

  const { data: countryCode } = useQuery<string>({ queryKey: ["user", "country"] });

  const { data, isPending } = useQuery({
    queryKey: ["ramp", "quote", "manteca", typedCurrency],
    queryFn: typedCurrency ? () => getRampQuote({ provider: "manteca", currency: typedCurrency }) : undefined,
    enabled: !!typedCurrency,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: providers } = useQuery({
    queryKey: ["ramp", "providers", countryCode],
    queryFn: () => getRampProviders(countryCode),
    enabled: !!countryCode,
    staleTime: 60_000,
  });

  const depositInfo = data?.depositInfo.at(0);
  const quote = data?.quote;
  const beneficiaryName = depositInfo && "beneficiaryName" in depositInfo ? depositInfo.beneficiaryName : undefined;
  const pixKey = depositInfo?.network === "PIX" ? depositInfo.pixKey : undefined;
  const pix = useMemo(() => {
    if (!pixKey || !beneficiaryName) return null;
    try {
      const result = createStatic({
        merchantAccountInfo: { key: pixKey },
        merchantName: beneficiaryName,
        merchantCity: "São Paulo",
        postalCode: "00000-000",
      });
      result.toBase64.catch(() => {}); // eslint-disable-line @typescript-eslint/no-empty-function
      return result;
    } catch (error) {
      reportError(error);
      return null;
    }
  }, [pixKey, beneficiaryName]);
  const qrCode = pix?.brcode; // cspell:ignore brcode

  if (!typedCurrency) return <Redirect href="/add-funds" />;

  const depositAddress =
    depositInfo?.network === "ARG_FIAT_TRANSFER"
      ? depositInfo.cbu
      : depositInfo?.network === "PIX"
        ? depositInfo.pixKey
        : undefined;
  const depositAlias = depositInfo?.network === "ARG_FIAT_TRANSFER" ? depositInfo.depositAlias : undefined;
  const limits = providers?.manteca.onramp.limits;
  const limitCurrency = limits?.monthly?.symbol;
  const minAmount = quote?.buyRate ? Number(quote.buyRate) : undefined;
  const maxAmount = limits?.monthly?.available ? Number(limits.monthly.available) : undefined;

  function formatAmount(amount: number) {
    return amount.toLocaleString(language, { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function copyToClipboard(text: string) {
    setStringAsync(text)
      .then(() => {
        toast.show(t("Copied!"), { native: true, duration: 1000, burntOptions: { haptic: "success" } });
      })
      .catch(reportError);
  }

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <View gap="$s4_5">
          <View flexDirection="row" gap="$s3_5" justifyContent="space-between" alignItems="center">
            <Pressable
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(main)/add-funds");
                }
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
            <Text secondary emphasized>
              {t("Details")}
            </Text>
            <Pressable hitSlop={15}>
              <Info size={16} color="$uiNeutralPrimary" />
            </Pressable>
          </View>
        </View>
        <ScrollView flex={1}>
          <View flex={1} gap="$s4_5">
            <YStack flex={1} padding="$s4" gap="$s5">
              <YStack gap="$s4" alignSelf="center">
                <Text emphasized title3>
                  {currency} {t("Account details")}
                </Text>
                <Text color="$uiNeutralPlaceholder" subHeadline>
                  {t("Transfer {{currency}} from bank accounts under your name to receive USDC in your Exa App.", {
                    currency,
                  })}
                </Text>
              </YStack>
              <YStack gap="$s4" backgroundColor="$backgroundSoft" padding="$s4_5" borderRadius="$r3">
                <DetailRow
                  label={t("Beneficiary name")}
                  value={beneficiaryName}
                  isLoading={isPending}
                  onCopy={() => {
                    if (!beneficiaryName) return;
                    copyToClipboard(beneficiaryName);
                  }}
                />
                <DetailRow
                  label={depositInfo?.displayName ?? t("Account")}
                  value={depositAddress}
                  isLoading={isPending}
                  onCopy={() => {
                    if (!depositAddress) return;
                    copyToClipboard(depositAddress);
                  }}
                />
                {depositAlias && (
                  <DetailRow
                    label={t("Deposit alias")}
                    value={depositAlias}
                    isLoading={isPending}
                    onCopy={() => {
                      if (!depositAlias) return;
                      copyToClipboard(depositAlias);
                    }}
                  />
                )}
              </YStack>
              {qrCode && (
                <Button
                  onPress={() => setQRSheetOpen(true)}
                  flexBasis={60}
                  contained
                  main
                  spaced
                  fullwidth
                  iconAfter={<QrCode size={20} />}
                >
                  {t("Show QR Code")}
                </Button>
              )}
              <InfoAlert title={t("All deposits must be from bank accounts under your name.")} />
            </YStack>
          </View>
        </ScrollView>
        <YStack gap="$s4" padding="$s2">
          <Separator height={1} borderColor="$borderNeutralSoft" />

          <YStack gap="$s2" paddingHorizontal="$s4_5">
            <XStack gap="$s3" alignItems="center">
              <Banknote size={24} color="$uiNeutralPrimary" />
              <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                {t("Amount")}
              </Text>
              <XStack alignItems="center">
                {currency === limitCurrency &&
                  (minAmount === undefined ? (
                    <Skeleton width={80} height={16} />
                  ) : (
                    <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                      {`${t("Min")} ${limitCurrency} ${formatAmount(minAmount)} - `}
                    </Text>
                  ))}
                {maxAmount !== undefined && limitCurrency ? (
                  <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                    {`${t("Max")} ${limitCurrency} ${formatAmount(maxAmount)}`}
                  </Text>
                ) : (
                  <Skeleton width={80} height={16} />
                )}
              </XStack>
            </XStack>
            <XStack gap="$s3" alignItems="center">
              <CalendarDays size={24} color="$uiNeutralPrimary" />
              <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                {t("Delivery time")}
              </Text>
              {depositInfo?.estimatedProcessingTime ? (
                <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                  {Number.isFinite(Number(depositInfo.estimatedProcessingTime))
                    ? t("Between {{min}} and {{max}} minutes", {
                        min: Math.round(Number(depositInfo.estimatedProcessingTime) / 60),
                        max: Math.round(Number(depositInfo.estimatedProcessingTime) / 60) + 5,
                      })
                    : depositInfo.estimatedProcessingTime}
                </Text>
              ) : (
                <Skeleton width={100} height={16} />
              )}
            </XStack>
            <XStack gap="$s3" alignItems="center">
              <Repeat size={24} color="$uiNeutralPrimary" />
              <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                {t("Exchange rate")}
              </Text>
              <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                {quote?.buyRate ? (
                  `${currency} ${Number(quote.buyRate).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })} ~ 1 USDC`
                ) : (
                  <Skeleton width={100} height={16} />
                )}
              </Text>
            </XStack>
            {depositInfo?.fee && Number.parseFloat(depositInfo.fee) !== 0 && (
              <XStack gap="$s3" alignItems="center">
                <Percent size={24} color="$uiNeutralPrimary" />
                <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                  {t("Fee")}
                </Text>
                <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                  {depositInfo.fee}
                </Text>
              </XStack>
            )}
            <MantecaDisclaimer primary />
          </YStack>
        </YStack>
      </View>
      {qrCode && (
        <ModalSheet open={qrSheetOpen} onClose={() => setQRSheetOpen(false)}>
          <SafeView borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
            <YStack gap="$s4" alignItems="center" padding="$s5">
              <Text emphasized headline color="$uiNeutralPrimary">
                {t("Deposit with PIX")}
              </Text>
              <YStack padding="$s3" borderRadius="$r4" backgroundColor="white" overflow="hidden">
                <QRCode
                  data={qrCode}
                  size={200}
                  pieceBorderRadius={2}
                  innerEyesOptions={{ borderRadius: 2 }}
                  isPiecesGlued
                  outerEyesOptions={{ borderRadius: 2 }}
                />
              </YStack>
              <InfoAlert title={t("All deposits must be from bank accounts under your name.")} />
              <Pressable onPress={() => setQRSheetOpen(false)}>
                <Text emphasized footnote color="$uiBrandSecondary">
                  {t("Close")}
                </Text>
              </Pressable>
            </YStack>
          </SafeView>
        </ModalSheet>
      )}
    </SafeView>
  );
}
