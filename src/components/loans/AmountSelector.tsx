import React, { useCallback, useState } from "react";

import { Separator, XStack, YStack } from "tamagui";

import { useForm } from "@tanstack/react-form";
import { nonEmpty, pipe, string } from "valibot";
import { formatUnits, parseUnits } from "viem";

import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import Input from "../shared/Input";
import Text from "../shared/Text";

import type { Hex } from "@exactly/common/validation";

export default function AmountSelector({
  onChange,
  market,
}: {
  market: Hex;
  onChange: (value: bigint, highAmount: boolean) => void;
}) {
  const { market: selectedMarket, borrowAvailable } = useAsset(market);
  const { Field, setFieldValue, getFieldValue } = useForm({ defaultValues: { assetInput: "" } });
  const [focused, setFocused] = useState(false);

  const highAmount =
    Number(getFieldValue("assetInput")) >=
    Number(formatUnits((borrowAvailable * 75n) / 100n, selectedMarket?.decimals ?? 0));

  const handleAmountChange = useCallback(
    (value: string) => {
      setFieldValue("assetInput", value);
      if (!selectedMarket) return;
      const inputAmount = parseUnits(
        value.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""),
        selectedMarket.decimals,
      );
      const newHighAmount =
        Number(formatUnits(inputAmount, selectedMarket.decimals)) >=
        Number(formatUnits((borrowAvailable * 75n) / 100n, selectedMarket.decimals));
      onChange(inputAmount, newHighAmount);
    },
    [selectedMarket, borrowAvailable, setFieldValue, onChange],
  );

  const handlePercentage = useCallback(
    (percentage: number) => {
      if (selectedMarket) {
        const amount = (borrowAvailable * BigInt(percentage)) / 100n;
        setFieldValue("assetInput", formatUnits(amount, selectedMarket.decimals));
        const newHighAmount =
          Number(formatUnits(amount, selectedMarket.decimals)) >=
          Number(formatUnits((borrowAvailable * 75n) / 100n, selectedMarket.decimals));
        onChange(amount, newHighAmount);
      }
    },
    [selectedMarket, borrowAvailable, setFieldValue, onChange],
  );
  return (
    <YStack
      gap="$s3"
      borderRadius="$r3"
      backgroundColor="$backgroundSoft"
      paddingTop="$s6"
      paddingBottom="$s5"
      paddingHorizontal="$s4"
    >
      <YStack gap="$s6">
        <YStack maxWidth="80%" minWidth="60%" alignSelf="center">
          <Field name="assetInput" validators={{ onChange: pipe(string(), nonEmpty("empty amount")) }}>
            {({ state: { value } }) => {
              return (
                <XStack
                  justifyContent="center"
                  alignSelf="center"
                  alignItems="center"
                  hitSlop={15}
                  flexShrink={1}
                  gap="$s2"
                  maxWidth="80%"
                  height={60}
                >
                  <AssetLogo
                    symbol={
                      selectedMarket?.symbol.slice(3) === "WETH" ? "ETH" : (selectedMarket?.symbol.slice(3) ?? "")
                    }
                    width={32}
                    height={32}
                  />
                  <Input
                    height="auto"
                    inputMode="decimal"
                    onChangeText={handleAmountChange}
                    placeholder="0"
                    onFocus={() => {
                      setFocused(true);
                    }}
                    onBlur={() => {
                      setFocused(false);
                    }}
                    value={value}
                    color={highAmount ? "$interactiveBaseErrorDefault" : "$uiNeutralPrimary"}
                    alignSelf="center"
                    borderWidth={0}
                    fontSize={34}
                    fontWeight="400"
                    letterSpacing={-0.2}
                    cursor="pointer"
                    textAlign="center"
                    backgroundColor="$backgroundSoft"
                    borderBottomLeftRadius={0}
                    borderBottomRightRadius={0}
                    flex={1}
                  />
                </XStack>
              );
            }}
          </Field>
          <Separator
            height={1}
            borderColor={highAmount ? "$borderErrorStrong" : focused ? "$borderBrandStrong" : "$borderNeutralSoft"}
          />
        </YStack>
        <XStack gap="$s4" justifyContent="center" flexWrap="wrap" alignItems="center">
          {Array.from({ length: 4 }).map((_, index) => {
            const percentage = index === 0 ? 5 : index * 25;
            const selected =
              selectedMarket && getFieldValue("assetInput")
                ? parseUnits(
                    getFieldValue("assetInput")
                      .replaceAll(/\D/g, ".")
                      .replaceAll(/\.(?=.*\.)/g, ""),
                    selectedMarket.decimals,
                  ) ===
                  (borrowAvailable * BigInt(percentage)) / 100n
                : false;
            const danger = selected && index === 3;
            return (
              <XStack
                key={percentage}
                borderWidth={1}
                borderRadius="$r_0"
                alignItems="center"
                justifyContent="center"
                paddingVertical="$s2"
                paddingHorizontal="$s4"
                borderColor={selected ? (danger ? "$borderErrorStrong" : "$borderBrandStrong") : "$borderNeutralSoft"}
                cursor="pointer"
                backgroundColor={
                  selected
                    ? danger
                      ? "$interactiveBaseErrorSoftDefault"
                      : "$interactiveBaseBrandSoftDefault"
                    : "$backgroundMild"
                }
                onPress={() => {
                  handlePercentage(percentage);
                }}
              >
                <Text
                  color={
                    selected
                      ? danger
                        ? "$interactiveOnBaseErrorSoft"
                        : "$interactiveOnBaseBrandSoft"
                      : "$uiNeutralSecondary"
                  }
                  footnote
                  textAlign="center"
                >{`${percentage}%`}</Text>
              </XStack>
            );
          })}
        </XStack>
      </YStack>
    </YStack>
  );
}
