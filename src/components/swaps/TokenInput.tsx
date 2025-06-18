import { WAD } from "@exactly/lib";
import type { Token } from "@lifi/sdk";
import { useForm } from "@tanstack/react-form";
import { Skeleton } from "moti/skeleton";
import React, { useCallback, useEffect } from "react";
import { Appearance, Image, Pressable } from "react-native";
import { styled, XStack, YStack } from "tamagui";
import { pipe, string, nonEmpty } from "valibot";
import { formatUnits, parseUnits } from "viem";

import useAccountAssets from "../../utils/useAccountAssets";
import Input from "../shared/Input";
import Text from "../shared/Text";
import View from "../shared/View";

interface TokenInputProperties {
  label: string;
  token?: Token;
  external?: boolean;
  amount: bigint;
  isLoading?: boolean;
  isActive: boolean;
  onTokenSelect: () => void;
  onFocus?: () => void;
  onChange?: (amount: bigint) => void;
}

export default function TokenInput({
  label,
  token,
  external,
  amount,
  isLoading = false,
  isActive,
  onTokenSelect,
  onFocus,
  onChange,
}: TokenInputProperties) {
  const { externalAssets, protocolAssets } = useAccountAssets();

  const { Field, setFieldValue } = useForm({
    defaultValues: {
      amountInput: "",
    },
  });

  const getBalance = useCallback(() => {
    if (!token) return 0n;
    if (external) {
      return externalAssets.find((a) => a.address === token.address)?.amount ?? 0n;
    }
    return protocolAssets.find((a) => a.asset === token.address)?.floatingDepositAssets ?? 0n;
  }, [external, externalAssets, protocolAssets, token]);

  const handleAmountChange = useCallback(
    (value: string) => {
      setFieldValue("amountInput", value);

      if (!token) return;
      const inputAmount = parseUnits(value.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), token.decimals);
      onChange?.(inputAmount);
    },
    [setFieldValue, token, onChange],
  );

  const usdValue =
    amount && token ? Number(formatUnits((amount * parseUnits(token.priceUSD, 18)) / WAD, token.decimals)) : 0;

  useEffect(() => {
    if (!isActive && token) {
      setFieldValue("amountInput", amount > 0n ? formatUnits(amount, token.decimals) : "");
    }
  }, [isActive, amount, token, setFieldValue]);

  useEffect(() => {
    setFieldValue("amountInput", "");
  }, [setFieldValue, token]);

  return (
    <YStack borderWidth={1} borderColor="$borderNeutralSoft" borderRadius="$r3" padding="$s4_5" gap="$s4_5">
      <Text emphasized footnote color="$uiNeutralSecondary">
        {label}
      </Text>

      <XStack gap="$s3_5" alignItems="center">
        <Pressable onPress={onTokenSelect}>
          {token ? (
            <Image source={{ uri: token.logoURI }} width={40} height={40} borderRadius={16} />
          ) : (
            <Skeleton radius="round" colorMode={Appearance.getColorScheme() ?? "light"} height={40} width={40} />
          )}
        </Pressable>

        <YStack flex={1} gap="$s2">
          <XStack alignItems="center" gap="$s2" justifyContent="space-between">
            {isLoading && !isActive ? (
              <View flex={1}>
                <Skeleton height={28} width="100%" colorMode={Appearance.getColorScheme() ?? "light"} />
              </View>
            ) : (
              <Field name="amountInput" validators={{ onChange: pipe(string(), nonEmpty("empty")) }}>
                {({ state }) => (
                  <AmountInput
                    value={isActive ? state.value : token ? formatUnits(amount, token.decimals) : ""}
                    onChangeText={handleAmountChange}
                    onFocus={onFocus}
                    placeholder={amount.toString()}
                  />
                )}
              </Field>
            )}

            {token && (
              <Text subHeadline color="$uiNeutralPlaceholder">
                / {Number(formatUnits(getBalance(), token.decimals)).toFixed(4)}
              </Text>
            )}
          </XStack>
          <XStack paddingHorizontal="$s3">
            {isLoading && !isActive ? (
              <View flex={1}>
                <Skeleton height={28} width={100} colorMode={Appearance.getColorScheme() ?? "light"} />
              </View>
            ) : (
              <Text callout color="$uiNeutralPlaceholder">
                {usdValue > 0 && "≈ "}
                {usdValue.toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                  currencyDisplay: "narrowSymbol",
                })}
              </Text>
            )}
          </XStack>
        </YStack>
      </XStack>
    </YStack>
  );
}

const AmountInput = styled(Input, {
  flex: 1,
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
  focusStyle: { borderColor: "$borderBrandStrong", borderWidth: 1 },
});
