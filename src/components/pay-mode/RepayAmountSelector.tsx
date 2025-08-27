import { marketUSDCAddress } from "@exactly/common/generated/chain";
import type { Hex } from "@exactly/common/validation";
import { useForm } from "@tanstack/react-form";
import React, { useCallback, useEffect, useState } from "react";
import { Separator, Slider, styled, XStack, YStack } from "tamagui";
import { nonEmpty, pipe, string } from "valibot";
import { formatUnits, parseUnits } from "viem";

import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import Input from "../shared/Input";
import Text from "../shared/Text";

export default function RepayAmountSelector({
  onChange,
  maxPositionAssets,
  balancerBalance,
  positionValue,
  repayMarket,
}: {
  onChange: (value: bigint) => void;
  maxPositionAssets: bigint;
  balancerBalance?: bigint;
  positionValue: bigint;
  repayMarket?: Hex;
}) {
  const { market: exaUSDC } = useAsset(marketUSDCAddress);
  const { Field, setFieldValue } = useForm({ defaultValues: { assetInput: "" } });
  const [focused, setFocused] = useState(false);
  const [inputValue, setInputValue] = useState(0n);
  const [maxReached, setMaxReached] = useState(false);

  const balancerBalanceUSD =
    balancerBalance && exaUSDC ? (balancerBalance * exaUSDC.usdPrice) / 10n ** BigInt(exaUSDC.decimals) : 0n;

  const handleAmountChange = useCallback(
    (value: string) => {
      setFieldValue("assetInput", value);
      if (!exaUSDC) return;
      const inputAmount = parseUnits(value.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), exaUSDC.decimals);
      if (inputAmount > maxPositionAssets) {
        onChange(maxPositionAssets);
        setFieldValue("assetInput", formatUnits(maxPositionAssets, exaUSDC.decimals));
        setInputValue(maxPositionAssets);
        setMaxReached(true);
      } else {
        onChange(inputAmount);
        setFieldValue("assetInput", formatUnits(inputAmount, exaUSDC.decimals));
        setInputValue(inputAmount);
        setMaxReached(false);
      }
    },
    [exaUSDC, setFieldValue, onChange, maxPositionAssets],
  );

  const handleSliderChange = useCallback(
    (values: number[]) => {
      if (!exaUSDC) return;
      const value = Number(values[0]);
      if (value > Number(maxPositionAssets) / 10 ** exaUSDC.decimals) {
        const amount = maxPositionAssets;
        onChange(amount);
        setFieldValue("assetInput", formatUnits(amount, exaUSDC.decimals));
        setInputValue(amount);
        setMaxReached(true);
      } else {
        const amount = parseUnits(value.toString(), exaUSDC.decimals);
        onChange(amount);
        setFieldValue("assetInput", value.toString());
        setInputValue(amount);
        setMaxReached(false);
      }
    },
    [onChange, setFieldValue, exaUSDC, maxPositionAssets],
  );

  useEffect(() => {
    onChange(0n);
    setFieldValue("assetInput", BigInt(0).toString());
    setInputValue(0n);
    setMaxReached(false);
  }, [repayMarket, setFieldValue, onChange]);

  return (
    <YStack
      gap="$s3"
      borderRadius="$r3"
      backgroundColor="$backgroundSoft"
      paddingTop="$s3"
      paddingBottom="$s3"
      paddingHorizontal="$s4"
    >
      <YStack gap="$s4">
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
                  <AssetLogo uri={assetLogos.USDC} width={32} height={32} />
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
                    color="$uiNeutralPrimary"
                  />
                </XStack>
              );
            }}
          </Field>
          <Separator height={1} borderColor={focused ? "$borderBrandStrong" : "$borderNeutralSoft"} />
        </YStack>
        <YStack justifyContent="space-between" flexWrap="wrap" alignItems="flex-start" gap="$s3">
          {exaUSDC && (
            <Slider
              onValueChange={handleSliderChange}
              value={[Number(inputValue) / 10 ** exaUSDC.decimals]}
              width="100%"
              min={0}
              max={Number(positionValue) / 10 ** exaUSDC.decimals}
              step={0.1}
            >
              <Slider.Track backgroundColor={maxReached ? "$interactiveBaseErrorSoftDefault" : "$backgroundBrandMild"}>
                <Slider.TrackActive backgroundColor="$uiBrandSecondary" />
              </Slider.Track>
              <Slider.Thumb circular index={0} size={20} backgroundColor="$uiBrandSecondary" />
            </Slider>
          )}
          {maxReached && (
            <Text caption color="$interactiveBaseErrorDefault">
              Maximum balance reached
            </Text>
          )}
        </YStack>
        {balancerBalance && positionValue > balancerBalance && (
          <Text caption color="$uiNeutralPlaceholder">
            Limit&nbsp;
            {(Number(balancerBalanceUSD) / 1e18).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
            &nbsp;per repay. Please split larger amounts into smaller payments.
          </Text>
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
