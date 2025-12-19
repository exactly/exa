import { marketUSDCAddress } from "@exactly/common/generated/chain";
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
}: {
  onChange: (value: bigint) => void;
  maxPositionAssets: bigint;
  balancerBalance?: bigint;
  positionValue: bigint;
}) {
  const { market: exaUSDC } = useAsset(marketUSDCAddress);
  const { Field, setFieldValue } = useForm({ defaultValues: { assetInput: "" } });

  const [focused, setFocused] = useState(false);
  const [inputValue, setInputValue] = useState(0n);
  const maxReached = inputValue >= maxPositionAssets;

  const [previousMax, setPreviousMax] = useState(maxPositionAssets);

  if (maxPositionAssets !== previousMax) {
    setPreviousMax(maxPositionAssets);
    if (inputValue > maxPositionAssets) {
      setInputValue(maxPositionAssets);
    }
  }

  const balancerBalanceUSD =
    balancerBalance && exaUSDC ? (balancerBalance * exaUSDC.usdPrice) / 10n ** BigInt(exaUSDC.decimals) : 0n;

  const handleAmountChange = useCallback(
    (value: string) => {
      const formattedValue = value.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, "");
      const inputAmount = parseUnits(formattedValue, 6);
      if (inputAmount > maxPositionAssets) {
        setInputValue(maxPositionAssets);
      } else {
        setInputValue(inputAmount);
        setFieldValue("assetInput", formattedValue);
      }
    },
    [maxPositionAssets, setFieldValue],
  );

  const handleSliderChange = useCallback(
    (values: number[]) => {
      const value = Number(values[0]);
      if (value > Number(maxPositionAssets) / 10 ** 6) {
        setInputValue(maxPositionAssets);
        setFieldValue("assetInput", formatUnits(maxPositionAssets, 6));
      } else {
        const amount = parseUnits(String(value), 6);
        setInputValue(amount);
        setFieldValue("assetInput", String(value));
      }
    },
    [maxPositionAssets, setFieldValue],
  );

  useEffect(() => {
    onChange(inputValue);
    if (inputValue >= maxPositionAssets) setFieldValue("assetInput", formatUnits(inputValue, 6));
  }, [inputValue, onChange, setFieldValue, maxPositionAssets]);

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
            {({ state: { value } }) => (
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
                <AssetLogo source={{ uri: assetLogos.USDC }} width={32} height={32} />
                <AmountInput
                  height="auto"
                  inputMode="decimal"
                  onChangeText={handleAmountChange}
                  placeholder="0"
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  value={value}
                  color="$uiNeutralPrimary"
                />
              </XStack>
            )}
          </Field>
          <Separator height={1} borderColor={focused ? "$borderBrandStrong" : "$borderNeutralSoft"} />
        </YStack>

        <YStack justifyContent="space-between" flexWrap="wrap" alignItems="flex-start" gap="$s3">
          {exaUSDC && (
            <Slider
              onValueChange={handleSliderChange}
              value={[Math.min(Number(inputValue), Number(positionValue)) / 10 ** exaUSDC.decimals]}
              width="100%"
              min={0}
              max={Number(positionValue) / 10 ** exaUSDC.decimals}
              step={0.1}
            >
              <Slider.Track backgroundColor={maxReached ? "$interactiveBaseErrorSoftDefault" : "$backgroundBrandMild"}>
                <Slider.TrackActive backgroundColor="$uiBrandSecondary" />
              </Slider.Track>
              <Slider.Thumb
                circular
                index={0}
                size={20}
                backgroundColor="$uiBrandSecondary"
                borderColor="$borderBrandStrong"
                hitSlop={100}
              />
            </Slider>
          )}
          {maxReached && (
            <Text caption color="$interactiveBaseErrorDefault">
              Maximum balance reached
            </Text>
          )}
        </YStack>
        {balancerBalance && positionValue > balancerBalance ? (
          <Text caption color="$uiNeutralPlaceholder">
            Limit&nbsp;
            {(Number(balancerBalanceUSD) / 1e18).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
            &nbsp;per repay. Please split larger amounts into smaller payments.
          </Text>
        ) : null}
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
