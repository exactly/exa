import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";

import { Separator, Slider, XStack, YStack } from "tamagui";

import { formatUnits } from "viem";

import { min } from "@exactly/lib";

import parseAmount from "../../utils/parseAmount";
import AmountInput from "../shared/AmountInput";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";

export default function RepayAmountSelector({
  value,
  onChange,
  maxRepayInput,
  totalPositionRepay,
  balancerBalance,
  positionValue,
}: {
  balancerBalance: bigint | undefined;
  maxRepayInput: bigint;
  onChange: (value: bigint) => void;
  positionValue: bigint;
  totalPositionRepay: bigint;
  value: bigint;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [editingValue, setEditingValue] = useState<string | undefined>();

  const displayValue = editingValue ?? formatUnits(value, 6);
  const canPayFullDebt = maxRepayInput >= totalPositionRepay && totalPositionRepay > 0n;
  const effectiveMax = canPayFullDebt ? totalPositionRepay : maxRepayInput;
  const clampedValue = min(value, effectiveMax);
  const maxReached = clampedValue >= effectiveMax && effectiveMax > 0n;

  const sliderStep = useMemo(() => {
    const maxValue = Number(totalPositionRepay) / 1e6;
    const step = maxValue / 100;
    return Math.max(0.01, Math.round(step * 100) / 100);
  }, [totalPositionRepay]);

  const handleAmountChange = useCallback(
    (input: string) => {
      setEditingValue(input);
      const inputAmount = parseAmount(input, 6);
      if (inputAmount > effectiveMax) {
        onChange(effectiveMax);
        setEditingValue(formatUnits(effectiveMax, 6));
      } else {
        onChange(inputAmount);
      }
    },
    [onChange, effectiveMax],
  );

  const handleSliderChange = useCallback(
    (values: number[]) => {
      if (values[0] === undefined) return;
      const sliderValue = Math.round(values[0] * 1e6) / 1e6;
      setEditingValue(undefined);
      if (sliderValue >= Number(effectiveMax) / 1e6) {
        onChange(effectiveMax);
      } else {
        const sliderAmount = parseAmount(sliderValue.toFixed(6), 6);
        onChange(sliderAmount);
      }
    },
    [onChange, effectiveMax],
  );

  const handleMaxPress = useCallback(() => {
    setEditingValue(undefined);
    onChange(effectiveMax);
  }, [onChange, effectiveMax]);

  return (
    <YStack
      gap="s3"
      borderRadius="r3"
      backgroundColor="backgroundSoft"
      paddingTop="s3"
      paddingBottom="s3"
      paddingHorizontal="s4"
    >
      <XStack justifyContent="flex-end" alignItems="center">
        <Text
          emphasized
          subHeadline
          color="uiBrandSecondary"
          cursor="pointer"
          onPress={handleMaxPress}
          role="button"
          aria-label={t("Set maximum repay amount")}
          hitSlop={15}
        >
          {t("Max")}
        </Text>
      </XStack>
      <YStack gap="s4">
        <YStack maxWidth="80%" minWidth="60%" alignSelf="center">
          <XStack
            justifyContent="center"
            alignSelf="center"
            alignItems="center"
            flexShrink={1}
            gap="s2"
            maxWidth="80%"
            height={60}
            hitSlop={15}
          >
            <AssetLogo symbol="USDC" width={32} height={32} />
            <AmountInput
              aria-label={t("Repay amount")}
              alignSelf="center"
              backgroundColor="backgroundSoft"
              borderBottomLeftRadius={0}
              borderBottomRightRadius={0}
              borderWidth={0}
              color="uiNeutralPrimary"
              cursor="pointer"
              flex={1}
              height="auto"
              fontSize={34}
              fontWeight="400"
              letterSpacing={-0.2}
              textAlign="center"
              decimals={6}
              onBlur={() => {
                setFocused(false);
                setEditingValue(value > 0n ? formatUnits(value, 6) : undefined);
              }}
              onChangeText={handleAmountChange}
              onFocus={(event) => {
                setFocused(true);
                if (Platform.OS === "web" && "select" in event.currentTarget) event.currentTarget.select();
              }}
              placeholder="0"
              selectTextOnFocus
              value={displayValue}
            />
          </XStack>
          <Separator height={1} borderColor={focused ? "borderBrandStrong" : "borderNeutralSoft"} />
        </YStack>
        <YStack justifyContent="space-between" flexWrap="wrap" alignItems="flex-start" gap="s3">
          <Slider
            onValueChange={handleSliderChange}
            value={[Number(clampedValue) / 1e6]}
            width="100%"
            height={7}
            min={0}
            max={Number(totalPositionRepay) / 1e6}
            step={sliderStep}
          >
            <Slider.Track height="100%" backgroundColor="backgroundBrandMild" borderRadius="r_0" overflow="hidden">
              <Slider.TrackActive backgroundColor="uiBrandSecondary" />
            </Slider.Track>
            <Slider.Thumb
              circular
              index={0}
              width={20}
              height={20}
              backgroundColor="uiBrandSecondary hover:uiBrandSecondary press:uiBrandSecondary"
              borderColor="borderBrandStrong hover:borderBrandStrong press:borderBrandStrong"
              hitSlop={10}
              aria-label={t("Repay amount slider")}
              aria-valuetext={`${(Number(clampedValue) / 1e6).toLocaleString(language, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} USDC`}
            />
          </Slider>
          {maxReached && (
            <Text caption color="uiNeutralSecondary" aria-live="polite">
              {canPayFullDebt ? t("Full repayment selected.") : t("Maximum amount selected.")}
            </Text>
          )}
        </YStack>
        {balancerBalance !== undefined && positionValue > balancerBalance && (
          <Text caption color="uiNeutralPlaceholder" aria-live="polite">
            {t("Limit {{amount}} per repay. Please split larger amounts into smaller payments.", {
              amount: `$${(Number(balancerBalance) / 1e6).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            })}
          </Text>
        )}
      </YStack>
    </YStack>
  );
}
