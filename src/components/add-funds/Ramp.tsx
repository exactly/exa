import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { setStringAsync } from "expo-clipboard";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, Banknote, CalendarDays, Copy, Info, Percent, Repeat } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import BridgeDisclaimer from "./BridgeDisclaimer";
import MantecaDisclaimer from "./MantecaDisclaimer";
import { isValidCurrency } from "../../utils/currencies";
import reportError from "../../utils/reportError";
import { getRampProviders, getRampQuote } from "../../utils/server";
import InfoAlert from "../shared/InfoAlert";
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
  const { provider, currency, cryptoCurrency, network } = useLocalSearchParams<{
    cryptoCurrency: string;
    currency: string;
    network: string;
    provider: string;
  }>();

  const typedCurrency = isValidCurrency(currency) ? currency : undefined;
  const isCrypto = !!cryptoCurrency && !!network;
  const displayCurrency = isCrypto ? `${cryptoCurrency} (${network})` : currency;

  const { data: countryCode } = useQuery<string>({ queryKey: ["user", "country"] });

  const { data, isPending } = useQuery({
    queryKey: ["ramp", "quote", provider, isCrypto, cryptoCurrency, network, typedCurrency],
    queryFn: () =>
      getRampQuote(
        isCrypto
          ? ({ provider: "bridge", cryptoCurrency, network } as Parameters<typeof getRampQuote>[0])
          : ({ provider: provider as "bridge" | "manteca", currency: typedCurrency } as Parameters<
              typeof getRampQuote
            >[0]),
      ),
    enabled: isCrypto || !!typedCurrency,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: providers } = useQuery({
    queryKey: ["ramp", "providers", countryCode],
    queryFn: () => getRampProviders(countryCode),
    enabled: !!countryCode,
    staleTime: 60_000,
  });

  if (!typedCurrency && !isCrypto) return <Redirect href="/add-funds" />;

  const depositInfo = data?.depositInfo.at(0);
  const quote = data?.quote;

  const providerData = providers?.[provider as keyof typeof providers];
  const limits = providerData?.onramp.limits;
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
      <View gap={20} fullScreen padded>
        <View gap={20}>
          <View flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
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
          <View flex={1} gap={20}>
            <YStack flex={1} padding="$s4" gap="$s5">
              <YStack gap="$s4" alignSelf="center">
                <Text emphasized title3>
                  {displayCurrency} {t("Account details")}
                </Text>
                <Text color="$uiNeutralPlaceholder" subHeadline>
                  {isCrypto
                    ? t("Send {{currency}} to the address below to receive it in your Exa App.", {
                        currency: cryptoCurrency,
                      })
                    : t("Transfer {{currency}} from bank accounts under your name to receive USDC in your Exa App.", {
                        currency,
                      })}
                </Text>
              </YStack>
              <YStack gap="$s4" backgroundColor="$backgroundSoft" padding="$s4_5" borderRadius="$r3">
                <DepositDetailRows
                  depositInfo={depositInfo}
                  isPending={isPending}
                  copyToClipboard={copyToClipboard}
                  t={t}
                />
              </YStack>
              {!isCrypto && <InfoAlert title={t("All deposits must be from bank accounts under your name.")} />}
            </YStack>
          </View>
        </ScrollView>
        <YStack gap="$s4" padding="$s2">
          <Separator height={1} borderColor="$borderNeutralSoft" />

          <YStack gap="$s2" paddingHorizontal="$s4_5">
            {!isCrypto && (
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
            )}
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
            {!isCrypto && (
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
            )}
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
            {provider === "bridge" ? <BridgeDisclaimer primary /> : <MantecaDisclaimer primary />}
          </YStack>
        </YStack>
      </View>
    </SafeView>
  );
}

type DepositInfo = NonNullable<Awaited<ReturnType<typeof getRampQuote>>>["depositInfo"][number];

function DepositDetailRows({
  depositInfo,
  isPending,
  copyToClipboard,
  t,
}: {
  copyToClipboard: (text: string) => void;
  depositInfo: DepositInfo | undefined;
  isPending: boolean;
  t: (key: string) => string;
}) {
  switch (depositInfo?.network) {
    case "ARG_FIAT_TRANSFER":
      return (
        <>
          <DetailRow
            label={t("Beneficiary name")}
            value={depositInfo.beneficiaryName}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.beneficiaryName)}
          />
          <DetailRow
            label={depositInfo.displayName}
            value={depositInfo.cbu}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.cbu)}
          />
          {depositInfo.depositAlias && (
            <DetailRow
              label={t("Deposit alias")}
              value={depositInfo.depositAlias}
              isLoading={isPending}
              onCopy={() => copyToClipboard(depositInfo.depositAlias ?? "")}
            />
          )}
        </>
      );
    case "PIX":
      return (
        <>
          <DetailRow
            label={t("Beneficiary name")}
            value={depositInfo.beneficiaryName}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.beneficiaryName)}
          />
          <DetailRow
            label={depositInfo.displayName}
            value={depositInfo.pixKey}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.pixKey)}
          />
        </>
      );
    case "ACH":
    case "WIRE":
      return (
        <>
          <DetailRow
            label={t("Beneficiary name")}
            value={depositInfo.beneficiaryName}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.beneficiaryName)}
          />
          <DetailRow
            label={t("Routing number")}
            value={depositInfo.routingNumber}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.routingNumber)}
          />
          <DetailRow
            label={t("Account number")}
            value={depositInfo.accountNumber}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.accountNumber)}
          />
          <DetailRow
            label={t("Bank name")}
            value={depositInfo.bankName}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.bankName)}
          />
          <DetailRow
            label={t("Bank address")}
            value={depositInfo.bankAddress}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.bankAddress)}
          />
        </>
      );
    case "SEPA":
      return (
        <>
          <DetailRow
            label={t("Beneficiary name")}
            value={depositInfo.beneficiaryName}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.beneficiaryName)}
          />
          <DetailRow
            label={t("IBAN")}
            value={depositInfo.iban}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.iban)}
          />
        </>
      );
    case "SPEI":
      return (
        <>
          <DetailRow
            label={t("Beneficiary name")}
            value={depositInfo.beneficiaryName}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.beneficiaryName)}
          />
          <DetailRow
            label={t("CLABE")}
            value={depositInfo.clabe}
            isLoading={isPending}
            onCopy={() => copyToClipboard(depositInfo.clabe)}
          />
        </>
      );
    case "TRON":
    case "SOLANA":
    case "STELLAR":
      return (
        <DetailRow
          label={`${depositInfo.displayName} ${t("address")}`}
          value={depositInfo.address}
          isLoading={isPending}
          onCopy={() => copyToClipboard(depositInfo.address)}
        />
      );
    default:
      return (
        <DetailRow
          label={t("Account")}
          value={undefined}
          isLoading={isPending}
          onCopy={() => {
            /* empty */
          }}
        />
      );
  }
}
