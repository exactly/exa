import React, { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { XStack, YStack } from "tamagui";

import { useForm } from "@tanstack/react-form";
import { nonEmpty, pipe, string } from "valibot";
import { formatUnits, parseUnits } from "viem";

import { WAD } from "@exactly/lib";

import AssetLogo from "../shared/AssetLogo";
import ChainLogo from "../shared/ChainLogo";
import Input from "../shared/Input";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Token } from "@lifi/sdk";

export default function TokenInput({
  label,
  subLabel,
  token,
  amount,
  balance,
  disabled,
  isLoading = false,
  isActive,
  isDanger,
  onTokenSelect,
  onFocus,
  onChange,
  onUseMax,
  usdValue,
}: {
  amount: bigint;
  balance: bigint;
  disabled?: boolean;
  isActive: boolean;
  isDanger?: boolean;
  isLoading?: boolean;
  label: string;
  onChange?: (amount: bigint) => void;
  onFocus?: () => void;
  onTokenSelect: () => void;
  onUseMax?: (amount: bigint) => void;
  subLabel?: string;
  token?: Token;
  usdValue?: number;
}) {
  const { Field, setFieldValue, getFieldValue } = useForm({ defaultValues: { amountInput: "" } });
  const {
    t,
    i18n: { language },
  } = useTranslation();

  const valueUSD =
    usdValue ??
    (amount && token ? Number(formatUnits((amount * parseUnits(token.priceUSD, 18)) / WAD, token.decimals)) : 0);
  const balanceUSD =
    token && balance ? Number(formatUnits((balance * parseUnits(token.priceUSD, 18)) / WAD, token.decimals)) : 0;
  const significantDecimals = token
    ? Math.min(8, Math.max(0, token.decimals - Math.ceil(Math.log10(Math.max(1, Number(token.priceUSD)))) + 2))
    : 0;
  const balanceAmount = token
    ? Number(formatUnits(balance, token.decimals)).toLocaleString(language, {
        maximumFractionDigits: significantDecimals,
      })
    : "0";
  const canUseMax = !!token && !!onUseMax;

  const handleAmountChange = useCallback(
    (value: string) => {
      setFieldValue("amountInput", value);
      if (!token) return;
      const inputAmount = parseUnits(value.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), token.decimals);
      onChange?.(inputAmount);
    },
    [setFieldValue, token, onChange],
  );

  const useMax = useCallback(() => {
    if (!token) return;
    setFieldValue("amountInput", formatUnits(balance, token.decimals));
    onChange?.(balance);
    onUseMax?.(balance);
  }, [balance, onChange, onUseMax, setFieldValue, token]);

  useEffect(() => {
    if (!isActive && token) {
      const value = formatUnits(amount, token.decimals);
      setFieldValue(
        "amountInput",
        amount > 0n
          ? disabled
            ? trimDecimals(value, significantDecimals)
            : value
          : disabled
            ? ""
            : getFieldValue("amountInput"),
      );
    }
  }, [isActive, amount, token, disabled, significantDecimals, setFieldValue, getFieldValue]);

  useEffect(() => {
    setFieldValue("amountInput", "");
  }, [setFieldValue, token]);

  return (
    <YStack
      borderWidth={1}
      borderColor={isDanger ? "$borderErrorStrong" : isActive ? "$borderBrandStrong" : "$borderNeutralSoft"}
      borderRadius="$r3"
      padding="$s4_5"
      gap="$s3"
      backgroundColor="$backgroundSoft"
    >
      <XStack alignItems="center" justifyContent="space-between">
        <YStack gap="$s1">
          <Text emphasized subHeadline color="$uiNeutralPrimary">
            {label}
          </Text>
          {subLabel ? (
            <Text footnote color="$uiNeutralSecondary">
              {subLabel}
            </Text>
          ) : null}
        </YStack>
        {canUseMax ? (
          <View
            padding="$s3"
            borderRadius="$r2"
            backgroundColor="$interactiveBaseBrandSoftDefault"
            onPress={useMax}
            cursor="pointer"
            pressStyle={{ opacity: 0.85 }}
          >
            <Text emphasized footnote color="$interactiveOnBaseBrandSoft">
              {t("MAX")}
            </Text>
          </View>
        ) : null}
      </XStack>
      <YStack gap="$s3_5">
        <XStack gap="$s3_5" alignItems="center">
          <View
            aria-label={t("Select token")}
            onPress={onTokenSelect}
            cursor="pointer"
            hitSlop={20}
            position="relative"
            width={40}
            height={40}
          >
            {token ? (
              <>
                <AssetLogo symbol={token.symbol} uri={token.logoURI} width={40} height={40} />
                <View
                  borderRadius="$r_0"
                  position="absolute"
                  bottom={0}
                  right={0}
                  width={20}
                  height={20}
                  borderWidth={1}
                  borderColor="white"
                  overflow="hidden"
                >
                  <ChainLogo chainId={token.chainId} size={18} />
                </View>
              </>
            ) : (
              <Skeleton radius="round" height={40} width={40} />
            )}
          </View>
          <YStack flex={1}>
            {isLoading && !isActive ? (
              <Skeleton height={28} width="100%" />
            ) : (
              <>
                <Field name="amountInput" validators={{ onChange: pipe(string(), nonEmpty("empty")) }}>
                  {({ state: { value } }) => (
                    <View width="100%">
                      <Input
                        value={value}
                        onChangeText={handleAmountChange}
                        onFocus={onFocus}
                        disabled={disabled}
                        cursor={disabled ? undefined : "pointer"}
                        placeholder={token ? formatUnits(amount, token.decimals) : String(amount)}
                        color={
                          isDanger ? "$uiErrorSecondary" : isActive ? "$uiNeutralPrimary" : "$uiNeutralPlaceholder"
                        }
                        fontSize={28}
                        fontWeight="bold"
                        letterSpacing={-0.2}
                        textAlign="left"
                        inputMode="decimal"
                        borderColor="transparent"
                        numberOfLines={1}
                        flex={1}
                        width="100%"
                      />
                    </View>
                  )}
                </Field>
                <XStack justifyContent="space-between" alignItems="flex-start">
                  {isLoading && !isActive ? (
                    <View flex={1}>
                      <Skeleton height={16} width={120} />
                    </View>
                  ) : (
                    <Text callout color="$uiNeutralPlaceholder">
                      {`${valueUSD > 0 ? "≈" : ""}$${valueUSD.toLocaleString(language, {
                        style: "decimal",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`}
                    </Text>
                  )}
                  {token ? (
                    <YStack alignItems="flex-end" gap="$s1">
                      <Text footnote color="$uiNeutralSecondary" numberOfLines={1}>
                        {t("Balance: {{value}}", {
                          value: `$${balanceUSD.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                        })}
                      </Text>
                      <Text caption color="$uiNeutralPlaceholder" numberOfLines={1}>
                        {`${balanceAmount} ${token.symbol}`}
                      </Text>
                    </YStack>
                  ) : null}
                </XStack>
              </>
            )}
          </YStack>
        </XStack>
      </YStack>
    </YStack>
  );
}

function trimDecimals(value: string, decimals: number) {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.slice(0, decimals).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : (whole ?? value);
}
