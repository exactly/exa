import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import QRCode from "react-native-qrcode-styled";

import { setStringAsync } from "expo-clipboard";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, Banknote, Clock, Copy, Percent, QrCode, Repeat } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import { createStatic } from "@pix.js/qrcode";
import { useQuery } from "@tanstack/react-query";

import domain from "@exactly/common/domain";

import BridgeDisclaimer from "./BridgeDisclaimer";
import MantecaDisclaimer from "./MantecaDisclaimer";
import { isValidCurrency, fees as rampFees } from "../../utils/currencies";
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

export default function Ramp() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const [qrSheetOpen, setQRSheetOpen] = useState(false);
  const { currency, provider } = useLocalSearchParams();

  const typedCurrency = isValidCurrency(currency) ? currency : undefined;
  const typedProvider = provider === "bridge" || provider === "manteca" ? provider : undefined;

  const { data: countryCode } = useQuery<string>({ queryKey: ["user", "country"] });

  const { data, isPending, isError } = useQuery({
    queryKey: ["ramp", "quote", typedProvider, typedCurrency],
    queryFn: () =>
      getRampQuote(
        typedProvider === "bridge"
          ? ({ provider: "bridge", currency: typedCurrency } as Parameters<typeof getRampQuote>[0])
          : ({ provider: "manteca", currency: typedCurrency } as Parameters<typeof getRampQuote>[0]),
      ),
    enabled: !!typedCurrency && !!typedProvider,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const redirectURL = `https://${domain}/add-funds`;
  const { data: providers } = useQuery({
    queryKey: ["ramp", "providers", countryCode, redirectURL],
    queryFn: () => getRampProviders(countryCode, redirectURL),
    enabled: !!countryCode,
    staleTime: 60_000,
  });

  const deposits = data?.depositInfo ?? [];
  const quote = data?.quote;
  const deposit = deposits.at(0);
  const bridgeFee =
    typedProvider === "bridge" && deposit && deposit.displayName in rampFees.bridge
      ? rampFees.bridge[deposit.displayName as keyof typeof rampFees.bridge].fee
      : undefined;
  const pixDeposit = deposits.find((d) => d.network === "PIX" || d.network === "PIX-BR");
  const qrCode = useMemo(() => {
    if (!pixDeposit) return;
    if (pixDeposit.network === "PIX-BR") return pixDeposit.brCode;
    try {
      return createStatic({
        merchantAccountInfo: { key: pixDeposit.pixKey },
        merchantName: pixDeposit.beneficiaryName,
        merchantCity: pixDeposit.merchantCity,
        postalCode: pixDeposit.postalCode,
      }).brcode; // cspell:ignore brcode
    } catch (error) {
      reportError(error);
    }
  }, [pixDeposit]);

  if (!typedCurrency || !typedProvider) return <Redirect href="/add-funds" />;

  const mantecaOnramp = providers?.manteca.onramp;
  const limits = mantecaOnramp && "limits" in mantecaOnramp ? mantecaOnramp.limits : undefined;
  const limitCurrency = limits?.monthly.symbol;
  const minAmount = quote?.buyRate ? Number(quote.buyRate) : undefined;
  const maxAmount = limits?.monthly.available ? Number(limits.monthly.available) : undefined;

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
              {deposits.length > 0
                ? t("{{currency}} via {{methods}}", {
                    currency: typedCurrency,
                    methods: deposits.map((d) => d.displayName).join(` ${t("or")} `),
                  })
                : t("Details")}
            </Text>
            <View width={24} />
          </View>
        </View>
        <ScrollView flex={1}>
          <View flex={1} gap="$s4_5">
            <YStack flex={1} padding="$s4" gap="$s5">
              <YStack gap="$s4" alignSelf="center">
                <Text emphasized title3>
                  {typedCurrency} {t("Account details")}
                </Text>
                {typedProvider === "manteca" && (
                  <Text color="$uiNeutralPlaceholder" subHeadline>
                    {t("Transfer {{currency}} from bank accounts under your name to receive USDC in your Exa App.", {
                      currency: typedCurrency,
                    })}
                  </Text>
                )}
                {typedProvider === "bridge" && (
                  <Text color="$uiNeutralPlaceholder" subHeadline>
                    {t("Copy and share your account details to receive transfers into your Exa account in USDC.")}
                  </Text>
                )}
              </YStack>
              {deposit && <DepositCard copyToClipboard={copyToClipboard} deposit={deposit} isLoading={isPending} />}
              {isPending && !deposit && (
                <YStack gap="$s4" backgroundColor="$backgroundSoft" padding="$s4_5" borderRadius="$r3">
                  <Skeleton width="100%" height={40} />
                  <Skeleton width="100%" height={40} />
                </YStack>
              )}
              {isError && !data && <InfoAlert title={t("Error loading account details. Please try again later.")} />}
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
              {typedProvider === "manteca" && (
                <InfoAlert title={t("All deposits must be from bank accounts under your name.")} />
              )}
            </YStack>
          </View>
        </ScrollView>
        <YStack gap="$s4" padding="$s2">
          <Separator height={1} borderColor="$borderNeutralSoft" />

          <YStack gap="$s2" paddingHorizontal="$s4_5">
            {typedProvider === "manteca" && (
              <XStack gap="$s3" alignItems="center">
                <Banknote size={16} color="$uiNeutralPrimary" />
                <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                  {t("Amount")}
                </Text>
                <XStack alignItems="center">
                  {typedCurrency === limitCurrency &&
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
            )}
            {typedProvider === "bridge" && (
              <XStack gap="$s3" alignItems="center">
                <View flexShrink={0} alignItems="center">
                  <Banknote size={16} color="$uiNeutralPrimary" />
                </View>
                <Text secondary caption2 color="$uiNeutralPlaceholder" flex={1}>
                  {t(
                    "We cover incoming transfers to your Bridge accounts in Exa App up to $3,000 or 60 transactions per month. Fees apply after that. {{method}}: {{fee}}.",
                    { fee: bridgeFee, method: deposit?.displayName },
                  )}
                </Text>
              </XStack>
            )}
            {deposits.some((d) => d.estimatedProcessingTime) && (
              <XStack gap="$s3" alignItems="flex-start">
                <Clock size={16} color="$uiNeutralPrimary" />
                <Text emphasized secondary caption2 color="$uiNeutralSecondary" flex={1}>
                  {t("Delivery time: {{details}}", {
                    details: deposits
                      .filter((d) => d.estimatedProcessingTime)
                      .map((d) => {
                        const seconds = Number(d.estimatedProcessingTime);
                        const time = Number.isFinite(seconds)
                          ? t("Between {{min}} and {{max}} minutes", {
                              min: Math.round(seconds / 60),
                              max: Math.round(seconds / 60) + 5,
                            })
                          : d.estimatedProcessingTime;
                        return `${d.displayName}: ${time}`;
                      })
                      .join(". "),
                  })}
                </Text>
              </XStack>
            )}
            {quote?.buyRate && (
              <XStack gap="$s3" alignItems="center">
                <Repeat size={16} color="$uiNeutralPrimary" />
                <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                  {t("Exchange rate")}
                </Text>
                <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                  {`${typedCurrency} ${Number(quote.buyRate).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })} ~ 1 USDC`}
                </Text>
              </XStack>
            )}
            {deposit?.fee && Number.parseFloat(deposit.fee) !== 0 && (
              <XStack gap="$s3" alignItems="center">
                <Percent size={16} color="$uiNeutralPrimary" />
                <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                  {t("Fee")}
                </Text>
                <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                  {deposit.fee}
                </Text>
              </XStack>
            )}
            {typedProvider === "bridge" ? <BridgeDisclaimer primary /> : <MantecaDisclaimer primary />}
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

type DepositCardProperties = {
  copyToClipboard: (text: string) => void;
  deposit: NonNullable<Awaited<ReturnType<typeof getRampQuote>>["depositInfo"][number]>;
  isLoading: boolean;
};

function DepositCard({ deposit, isLoading, copyToClipboard }: DepositCardProperties) {
  const { t } = useTranslation();
  const rows = depositRows(deposit);
  return (
    <YStack gap="$s4" backgroundColor="$backgroundSoft" padding="$s4_5" borderRadius="$r3">
      <Text emphasized secondary caption color="$uiNeutralPlaceholder">
        {deposit.displayName}
      </Text>
      {rows.map(({ label, value }) => (
        <DetailRow
          key={label}
          label={t(label)}
          value={value}
          isLoading={isLoading}
          onCopy={() => {
            if (value) copyToClipboard(value);
          }}
        />
      ))}
    </YStack>
  );
}

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

function depositRows(deposit: DepositCardProperties["deposit"]): { label: string; value: string }[] {
  switch (deposit.network) {
    case "ARG_FIAT_TRANSFER":
      return [
        ...("beneficiaryName" in deposit ? [{ label: "Beneficiary name", value: deposit.beneficiaryName }] : []),
        { label: deposit.displayName, value: deposit.cbu },
        ...("depositAlias" in deposit && deposit.depositAlias
          ? [{ label: "Deposit alias", value: deposit.depositAlias }]
          : []),
      ];
    case "PIX":
      return [
        { label: "Beneficiary name", value: deposit.beneficiaryName },
        { label: "PIX Key", value: deposit.pixKey },
      ];
    case "PIX-BR":
      return [
        { label: "Beneficiary name", value: deposit.beneficiaryName },
        { label: "BR Code", value: deposit.brCode },
      ];
    case "ACH":
    case "WIRE":
      return [
        { label: "Beneficiary name", value: deposit.beneficiaryName },
        { label: "Beneficiary address", value: deposit.beneficiaryAddress },
        { label: "Account number", value: deposit.accountNumber },
        { label: "Routing number", value: deposit.routingNumber },
        { label: "Bank name", value: deposit.bankName },
        { label: "Bank address", value: deposit.bankAddress },
      ];
    case "SEPA": // cspell:ignore sepa
      return [
        { label: "Beneficiary name", value: deposit.beneficiaryName },
        { label: "IBAN", value: deposit.iban },
      ];
    case "SPEI": // cspell:ignore spei
      return [
        { label: "Beneficiary name", value: deposit.beneficiaryName },
        { label: "CLABE", value: deposit.clabe },
      ];
    case "FASTER_PAYMENTS":
      return [
        { label: "Account holder", value: deposit.accountHolderName },
        { label: "Account number", value: deposit.accountNumber },
        { label: "Sort code", value: deposit.sortCode },
        { label: "Bank name", value: deposit.bankName },
        { label: "Bank address", value: deposit.bankAddress },
      ];
    default:
      return [];
  }
}
