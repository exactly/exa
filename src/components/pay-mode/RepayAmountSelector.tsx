import type { Hex } from "@exactly/common/validation";
import { useForm, useStore } from "@tanstack/react-form";
import React, { useCallback, useState } from "react";
import { Separator, styled, XStack, YStack } from "tamagui";
import { bigint, nonEmpty, pipe, string } from "valibot";
import { formatUnits, parseUnits } from "viem";

import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import Input from "../shared/Input";
import Text from "../shared/Text";
import { marketUSDCAddress } from "@exactly/common/generated/chain";

export default function RepayAmountSelector({
  onChange,
  maxRepayAmount,
  vaultAssetsUSD,
}: {
  onChange: (value: bigint) => void;
  maxRepayAmount: bigint;
  vaultAssetsUSD?: bigint;
}) {
  const { market: selectedMarket } = useAsset(marketUSDCAddress);
  const { Field, setFieldValue, getFieldValue, store } = useForm({ defaultValues: { assetInput: "" } });
  const [focused, setFocused] = useState(false);

  const inputValue = useStore(store, (state) => state.values.assetInput);

  const handleAmountChange = useCallback(
    (value: string) => {
      setFieldValue("assetInput", value);
      if (!selectedMarket) return;
      const inputAmount = parseUnits(
        value.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""),
        selectedMarket.decimals,
      );
      onChange(inputAmount);
    },
    [selectedMarket, maxRepayAmount, setFieldValue, onChange],
  );

  const handlePercentage = useCallback(
    (percentage: number) => {
      if (selectedMarket) {
        const amount = (maxRepayAmount * BigInt(percentage)) / 100n;
        setFieldValue("assetInput", formatUnits(amount, selectedMarket.decimals));
        onChange(amount);
      }
    },
    [selectedMarket, maxRepayAmount, setFieldValue, onChange],
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
                    uri={
                      assetLogos[
                        selectedMarket?.symbol.slice(3) === "WETH"
                          ? "ETH"
                          : (selectedMarket?.symbol.slice(3) as keyof typeof assetLogos)
                      ]
                    }
                    width={32}
                    height={32}
                  />
                  <AmountInput
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
                    color={"$uiNeutralPrimary"}
                  />
                </XStack>
              );
            }}
          </Field>
          <Separator height={1} borderColor={focused ? "$borderBrandStrong" : "$borderNeutralSoft"} />
        </YStack>
        <XStack justifyContent="space-between" flexWrap="wrap" alignItems="center">
          {Array.from({ length: 5 }).map((_, index) => {
            const percentage = index === 0 ? 5 : index * 25;
            const selected =
              selectedMarket && getFieldValue("assetInput")
                ? parseUnits(
                    getFieldValue("assetInput")
                      .replaceAll(/\D/g, ".")
                      .replaceAll(/\.(?=.*\.)/g, ""),
                    selectedMarket.decimals,
                  ) ===
                  (maxRepayAmount * BigInt(percentage)) / 100n
                : false;
            return (
              <XStack
                key={index}
                borderWidth={1}
                borderRadius="$r_0"
                alignItems="center"
                justifyContent="center"
                paddingVertical="$s2"
                paddingHorizontal="$s4"
                borderColor={selected ? "$borderBrandStrong" : "$borderNeutralSoft"}
                cursor="pointer"
                backgroundColor={selected ? "$interactiveBaseBrandSoftDefault" : "$backgroundMild"}
                onPress={() => {
                  handlePercentage(percentage);
                }}
              >
                <Text
                  color={selected ? "$interactiveOnBaseBrandSoft" : "$uiNeutralSecondary"}
                  footnote
                  textAlign="center"
                >{`${percentage}%`}</Text>
              </XStack>
            );
          })}
        </XStack>
        {parseUnits(inputValue, 6) > maxRepayAmount && (
          <XStack justifyContent="flex-end">
            <Text caption color={"$uiNeutralPlaceholder"}>
              Limit&nbsp;
              {(Number(vaultAssetsUSD ?? 0n) / 1e18).toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                currencyDisplay: "narrowSymbol",
              })}
              &nbsp;per repay. Please split larger amounts into smaller payments.
            </Text>
          </XStack>
        )}
      </YStack>
    </YStack>
  );
}
const AmountInput = styled(Input, {
  alignSelf: "center",
  borderWidth: 0,
  fontSize: 34,
  fontWeight: 400,
  letterSpacing: -0.2,
  cursor: "pointer",
  textAlign: "center",
  backgroundColor: "$backgroundSoft",
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0,
});
