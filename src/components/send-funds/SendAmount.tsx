import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Calendar,
  CircleDollarSign,
  CircleHelp,
  Info,
  Percent,
  TriangleAlert,
} from "@tamagui/lucide-icons";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { nonEmpty, pipe, string } from "valibot";
import { formatUnits, parseUnits } from "viem";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
import { WAD } from "@exactly/lib";

import { bridgeFee, bridgeFiatCurrencies, getSymbol } from "../../utils/currencies";
import { presentArticle } from "../../utils/intercom";
import parseAmount from "../../utils/parseAmount";
import reportError from "../../utils/reportError";
import { getRampQuote } from "../../utils/server";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

const MINIMUM_USDC = 10;
const DELIVERY_TIME = "2 business days";

const PERCENT_CHIPS = [5, 25, 50, 75] as const;

function isFiatCurrency(value: string): value is (typeof bridgeFiatCurrencies)[number] {
  return (bridgeFiatCurrencies as readonly string[]).includes(value);
}

export default function SendAmount() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const { currency, provider, contactId } = useLocalSearchParams();
  const currencyString = typeof currency === "string" ? currency : "";
  const contactString = typeof contactId === "string" ? contactId : "";
  const fiatCurrency = isFiatCurrency(currencyString) ? currencyString : undefined;
  const providerString = typeof provider === "string" ? provider : "";

  const { available } = useAsset(marketUSDCAddress);

  const { data: quote, isError: quoteError } = useQuery({
    queryKey: ["ramp", "quote", "offramp", { currency: fiatCurrency, externalAccountId: contactString }],
    queryFn: () => {
      if (!fiatCurrency || !contactString) throw new Error("invalid params");
      return getRampQuote({
        provider: "bridge",
        direction: "offramp",
        currency: fiatCurrency,
        externalAccountId: contactString,
      });
    },
    enabled: !!fiatCurrency && !!contactString,
  });

  const buyRate = quote?.quote?.buyRate;
  const rate = buyRate ? parseAmount(buyRate, 18) : undefined;
  const availableInTargetCurrency = rate ? (available * rate) / WAD : 0n;
  const symbol = getSymbol(currencyString);

  const form = useForm({
    defaultValues: { amount: "" },
    onSubmit: ({ value }) => {
      router.push({
        pathname: "/send-funds/review",
        params: { currency, provider, contactId, amount: value.amount },
      });
    },
  });

  const [focused, setFocused] = useState(false);
  const amountValue = useStore(form.store, ({ values }) => values.amount);
  const amountInTargetCurrency = parseAmount(amountValue);
  const usdcRequired = rate ? (amountInTargetCurrency * WAD + rate - 1n) / rate : 0n;
  const insufficient = usdcRequired > available;
  const belowMinimum = usdcRequired > 0n && usdcRequired < parseUnits(String(MINIMUM_USDC), 6);
  const hasError = insufficient || belowMinimum;
  const canContinue = !!rate && amountInTargetCurrency > 0n && !hasError;

  if (!fiatCurrency || !contactString || providerString !== "bridge") return <Redirect href="/send-funds" />;

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s5" fullScreen padded>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/send-funds");
            }}
          />
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("8950801").catch(reportError);
            }}
          />
        </XStack>

        <ScrollView flex={1}>
          <YStack flex={1} gap="$s5">
            <YStack gap="$s2">
              <Text title3 emphasized primary>
                {t("How much do you want to send?")}
              </Text>
              <XStack gap="$s2" alignItems="center">
                <Text footnote color="$uiNeutralPlaceholder">
                  {t("Available: {{amount}} USDC", {
                    amount: Number(formatUnits(available, 6)).toLocaleString(language, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    }),
                  })}
                </Text>
                <Info size={14} color="$uiNeutralPlaceholder" />
              </XStack>
            </YStack>

            <YStack
              backgroundColor="$backgroundSoft"
              borderRadius="$r3"
              paddingTop="$s6"
              paddingBottom="$s5"
              paddingHorizontal="$s4"
              gap="$s4"
              alignItems="center"
            >
              <form.Field name="amount" validators={{ onChange: pipe(string(), nonEmpty("empty amount")) }}>
                {({ state: { value }, handleChange }) => (
                  <YStack gap="$s2" minWidth="60%" maxWidth="80%" alignSelf="center">
                    <XStack alignItems="baseline" gap="$s2" justifyContent="center">
                      <Text title color={hasError ? "$interactiveBaseErrorDefault" : "$uiNeutralPlaceholder"}>
                        {symbol}
                      </Text>
                      <Input
                        placeholder="0.00"
                        value={value}
                        onChangeText={(text) => handleChange(text.replaceAll(/[^\d.,]/g, ""))}
                        onFocus={() => {
                          setFocused(true);
                        }}
                        onBlur={() => {
                          setFocused(false);
                        }}
                        keyboardType="decimal-pad"
                        fontSize={34}
                        fontWeight="400"
                        letterSpacing={-0.2}
                        borderWidth={0}
                        backgroundColor="transparent"
                        textAlign="center"
                        color={hasError ? "$interactiveBaseErrorDefault" : "$uiNeutralPrimary"}
                        minWidth={120}
                      />
                    </XStack>
                    <Separator
                      height={1}
                      borderColor={
                        hasError ? "$borderErrorStrong" : focused ? "$borderBrandStrong" : "$borderNeutralSoft"
                      }
                    />
                  </YStack>
                )}
              </form.Field>

              <XStack gap="$s2" alignItems="center">
                <AssetLogo symbol="USDC" width={14} height={14} />
                <Text footnote color={hasError ? "$uiErrorSecondary" : "$uiNeutralPlaceholder"}>
                  ≈ {Number(formatUnits(usdcRequired, 6)).toFixed(2)} USDC
                </Text>
              </XStack>

              <XStack gap="$s4" justifyContent="center" flexWrap="wrap" alignItems="center">
                {PERCENT_CHIPS.map((percent) => {
                  const chipAmount = (availableInTargetCurrency * BigInt(percent)) / 100n;
                  const chipValue = Number(formatUnits(chipAmount, 6)).toFixed(2);
                  const selected = amountValue === chipValue;
                  const danger = selected && percent === 75;
                  return (
                    <PercentChip
                      key={percent}
                      percent={percent}
                      selected={selected}
                      danger={danger}
                      onPress={() => {
                        form.setFieldValue("amount", chipValue);
                      }}
                    />
                  );
                })}
              </XStack>
            </YStack>

            {quoteError ? (
              <XStack gap="$s3" alignItems="center">
                <TriangleAlert size={16} color="$uiErrorSecondary" />
                <Text secondary caption flex={1}>
                  {t("Couldn't load the exchange rate. Please try again.")}
                </Text>
              </XStack>
            ) : hasError ? (
              <XStack gap="$s3" alignItems="center">
                <TriangleAlert size={16} color="$uiErrorSecondary" />
                <Text secondary caption flex={1}>
                  {insufficient
                    ? t("You don't have enough USDC for this amount.")
                    : t("Minimum amount is {{minimum}} USDC.", { minimum: MINIMUM_USDC })}
                </Text>
              </XStack>
            ) : null}
          </YStack>
        </ScrollView>

        <YStack paddingTop="$s4" borderTopWidth={1} borderTopColor="$borderNeutralSoft" gap="$s3">
          <SummaryRow
            icon={<CircleDollarSign size={16} color="$uiNeutralPlaceholder" />}
            label={t("Minimum amount")}
            value={`${MINIMUM_USDC} USDC`}
          />
          <SummaryRow
            icon={<Calendar size={16} color="$uiNeutralPlaceholder" />}
            label={t("Delivery time")}
            value={t(DELIVERY_TIME)}
          />
          <SummaryRow
            icon={<ArrowLeftRight size={16} color="$uiNeutralPlaceholder" />}
            label={t("Exchange rate")}
            value={rate ? `1 ${currencyString} = ${Number(formatUnits((WAD * WAD) / rate, 18)).toFixed(2)} USDC` : "—"}
          />
          <SummaryRow
            icon={<Percent size={16} color="$uiNeutralPlaceholder" />}
            label={t("Bridge transfer fee")}
            value={
              <>
                <Text emphasized strikeThrough color="$uiNeutralSecondary">
                  {bridgeFee(currencyString)}
                </Text>{" "}
                <Text emphasized color="$uiSuccessSecondary">
                  {t("Free")}
                </Text>
              </>
            }
          />
        </YStack>

        <Button
          primary
          disabled={!canContinue}
          onPress={() => {
            form.handleSubmit().catch(reportError);
          }}
        >
          <Button.Text>{t("Continue")}</Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
      </View>
    </SafeView>
  );
}

function PercentChip({
  percent,
  selected,
  danger,
  onPress,
}: {
  danger: boolean;
  onPress: () => void;
  percent: number;
  selected: boolean;
}) {
  return (
    <View
      borderWidth={1}
      borderColor={selected ? (danger ? "$borderErrorStrong" : "$borderBrandStrong") : "$borderNeutralSoft"}
      backgroundColor={
        selected
          ? danger
            ? "$interactiveBaseErrorSoftDefault"
            : "$interactiveBaseBrandSoftDefault"
          : "$backgroundMild"
      }
      borderRadius="$r_0"
      paddingHorizontal="$s4"
      paddingVertical="$s2"
      cursor="pointer"
      onPress={onPress}
    >
      <Text
        footnote
        color={
          selected ? (danger ? "$interactiveOnBaseErrorSoft" : "$interactiveOnBaseBrandSoft") : "$uiNeutralSecondary"
        }
      >
        {percent}%
      </Text>
    </View>
  );
}

function SummaryRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <XStack alignItems="center" gap="$s2">
      {icon}
      <Text footnote color="$uiNeutralPlaceholder">
        {label} <Text emphasized>{value}</Text>
      </Text>
    </XStack>
  );
}
