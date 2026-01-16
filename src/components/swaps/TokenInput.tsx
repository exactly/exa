import { WAD } from "@exactly/lib";
import type { Token } from "@lifi/sdk";
import { useForm } from "@tanstack/react-form";
import React, { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { XStack, YStack } from "tamagui";
import { nonEmpty, pipe, string } from "valibot";
import { formatUnits, parseUnits } from "viem";

import OptimismImage from "../../assets/images/optimism.svg";
import AssetLogo from "../shared/AssetLogo";
import Image from "../shared/Image";
import Input from "../shared/Input";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

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
  chainLogoUri,
}: {
  label: string;
  subLabel?: string;
  token?: Token;
  amount: bigint;
  balance: bigint;
  disabled?: boolean;
  isLoading?: boolean;
  isActive: boolean;
  isDanger?: boolean;
  onTokenSelect: () => void;
  onFocus?: () => void;
  onChange?: (amount: bigint) => void;
  onUseMax?: (amount: bigint) => void;
  chainLogoUri?: string;
}) {
  const { Field, setFieldValue, getFieldValue } = useForm({ defaultValues: { amountInput: "" } });
  const {
    t,
    i18n: { language },
  } = useTranslation();

  const valueUSD =
    amount && token ? Number(formatUnits((amount * parseUnits(token.priceUSD, 18)) / WAD, token.decimals)) : 0;
  const balanceUSD =
    token && balance ? Number(formatUnits((balance * parseUnits(token.priceUSD, 18)) / WAD, token.decimals)) : 0;
  const canUseMax = Boolean(token && !disabled);

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
      setFieldValue("amountInput", amount > 0n ? formatUnits(amount, token.decimals) : getFieldValue("amountInput"));
    }
  }, [isActive, amount, token, setFieldValue, getFieldValue]);

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
        <View
          padding="$s3"
          borderRadius="$r2"
          backgroundColor="$interactiveBaseBrandSoftDefault"
          onPress={canUseMax ? useMax : undefined}
          pointerEvents={canUseMax ? "auto" : "none"}
          opacity={canUseMax ? 1 : 0.4}
          cursor="pointer"
          pressStyle={{ opacity: 0.85 }}
        >
          <Text emphasized footnote color="$interactiveOnBaseBrandSoft">
            {t("MAX")}
          </Text>
        </View>
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
                <AssetLogo source={{ uri: token.logoURI }} width={40} height={40} />
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
                  {chainLogoUri ? (
                    <Image source={{ uri: chainLogoUri }} width="100%" height="100%" contentFit="cover" />
                  ) : (
                    <OptimismImage width="100%" height="100%" />
                  )}
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
                        style={{
                          fontFamily: "BDOGrotesk-Regular",
                          fontSize: 28,
                          fontWeight: "bold",
                          lineHeight: 34,
                          letterSpacing: -0.2,
                        }}
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
                <XStack justifyContent="space-between" alignItems="center">
                  {isLoading && !isActive ? (
                    <View flex={1}>
                      <Skeleton height={16} width={120} />
                    </View>
                  ) : (
                    <Text callout color="$uiNeutralPlaceholder">
                      {`${valueUSD > 0 ? "≈" : ""}${valueUSD.toLocaleString(language, {
                        style: "currency",
                        currency: "USD",
                        currencyDisplay: "narrowSymbol",
                      })}`}
                    </Text>
                  )}
                  {token ? (
                    <Text footnote color="$uiNeutralSecondary">
                      {t("Balance: {{value}}", {
                        value: balanceUSD.toLocaleString(language, {
                          style: "currency",
                          currency: "USD",
                          currencyDisplay: "narrowSymbol",
                        }),
                      })}
                    </Text>
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
