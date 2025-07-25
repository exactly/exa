import { WAD } from "@exactly/lib";
import type { Token } from "@lifi/sdk";
import { useForm } from "@tanstack/react-form";
import React, { useCallback, useEffect } from "react";
import { styled, XStack, YStack } from "tamagui";
import { pipe, string, nonEmpty } from "valibot";
import { formatUnits, parseUnits } from "viem";

import OptimismImage from "../../assets/images/optimism.svg";
import AssetLogo from "../shared/AssetLogo";
import Input from "../shared/Input";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function TokenInput({
  label,
  token,
  amount,
  balance,
  isLoading = false,
  isActive,
  isDanger,
  onTokenSelect,
  onFocus,
  onChange,
}: {
  label: string;
  token?: Token;
  amount: bigint;
  balance: bigint;
  isLoading?: boolean;
  isActive: boolean;
  isDanger?: boolean;
  onTokenSelect: () => void;
  onFocus?: () => void;
  onChange?: (amount: bigint) => void;
}) {
  const { Field, setFieldValue, getFieldValue } = useForm({ defaultValues: { amountInput: "" } });

  const handleAmountChange = useCallback(
    (value: string) => {
      setFieldValue("amountInput", value);
      if (!token) return;
      const inputAmount = parseUnits(value.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), token.decimals);
      onChange?.(inputAmount);
    },
    [setFieldValue, token, onChange],
  );

  const valueUSD =
    amount && token ? Number(formatUnits((amount * parseUnits(token.priceUSD, 18)) / WAD, token.decimals)) : 0;

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
      gap="$s4_5"
    >
      <Text emphasized footnote color="$uiNeutralSecondary">
        {label}
      </Text>
      <XStack gap="$s3_5" alignItems="center">
        <TokenImageContainer onPress={onTokenSelect}>
          {token ? (
            <>
              <AssetLogo external source={{ uri: token.logoURI }} width={40} height={40} borderRadius="$r_0" />
              <ChainLogoWrapper borderRadius="$r_0">
                <OptimismImage width="100%" height="100%" />
              </ChainLogoWrapper>
            </>
          ) : (
            <Skeleton radius="round" height={40} width={40} />
          )}
        </TokenImageContainer>
        <YStack flex={1} gap="$s2">
          <XStack alignItems="center" gap="$s2" justifyContent="space-between">
            {isLoading && !isActive ? (
              <View flex={1}>
                <Skeleton height={28} width="100%" />
              </View>
            ) : (
              <Field name="amountInput" validators={{ onChange: pipe(string(), nonEmpty("empty")) }}>
                {({ state }) => (
                  <XStack alignItems="center" justifyContent="space-between" gap="$s2" flex={1}>
                    <View flex={2}>
                      <AmountInput
                        value={state.value}
                        onChangeText={handleAmountChange}
                        onFocus={onFocus}
                        placeholder={amount.toString()}
                        color={
                          isDanger ? "$uiErrorSecondary" : isActive ? "$uiNeutralPrimary" : "$uiNeutralPlaceholder"
                        }
                      />
                    </View>
                    <View flex={1}>
                      <Text subHeadline color="$uiNeutralPlaceholder" textAlign="right">
                        {`/ ${token ? Number(formatUnits(balance, token.decimals)).toFixed(4) : 0} ${token?.symbol}`}
                      </Text>
                    </View>
                  </XStack>
                )}
              </Field>
            )}
          </XStack>
          <XStack paddingHorizontal="$s3">
            {isLoading && !isActive ? (
              <View flex={1}>
                <Skeleton height={28} width={100} />
              </View>
            ) : (
              <Text callout color="$uiNeutralPlaceholder">
                {`${valueUSD > 0 ? "≈" : ""}${valueUSD.toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                  currencyDisplay: "narrowSymbol",
                })}`}
              </Text>
            )}
          </XStack>
        </YStack>
      </XStack>
    </YStack>
  );
}

const AmountInput = styled(Input, {
  padding: 0,
  unstyled: true,
  fontSize: 28,
  letterSpacing: -0.2,
  textAlign: "left",
  inputMode: "decimal",
  paddingVertical: "$s2",
  paddingHorizontal: "$s3",
  placeholder: "0.00",
  cursor: "pointer",
  numberOfLines: 1,
});

const TokenImageContainer = styled(View, {
  cursor: "pointer",
  hitSlop: 20,
  position: "relative",
  width: 40,
  height: 40,
});

const ChainLogoWrapper = styled(View, {
  position: "absolute",
  bottom: 0,
  right: 0,
  width: 20,
  height: 20,
  borderWidth: 2,
  borderColor: "white",
  overflow: "hidden",
});
