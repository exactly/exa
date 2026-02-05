import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Separator, Slider, XStack, YStack } from "tamagui";

import { formatUnits, parseUnits } from "viem";

import { min } from "@exactly/lib";

import AssetLogo from "../shared/AssetLogo";
import Input from "../shared/Input";
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
      const formattedValue = input
        .replaceAll(",", ".")
        .replaceAll(/[^\d.]/g, "")
        .replaceAll(/\.(?=.*\.)/g, "");

      setEditingValue(formattedValue);

      if (!formattedValue || !Number.isFinite(Number(formattedValue)) || Number(formattedValue) < 0) {
        onChange(0n);
        return;
      }

      const inputAmount = parseUnits(formattedValue, 6);

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
        const sliderAmount = parseUnits(sliderValue.toFixed(6), 6);
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
      gap="$s3"
      borderRadius="$r3"
      backgroundColor="$backgroundSoft"
      paddingTop="$s3"
      paddingBottom="$s3"
      paddingHorizontal="$s4"
    >
      <XStack justifyContent="flex-end" alignItems="center">
        <Text
          emphasized
          subHeadline
          color="$uiBrandSecondary"
          onPress={handleMaxPress}
          cursor="pointer"
          role="button"
          aria-label={t("Set maximum repay amount")}
        >
          {t("Max")}
        </Text>
      </XStack>
      <YStack gap="$s4">
        <YStack maxWidth="80%" minWidth="60%" alignSelf="center">
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
            <AssetLogo symbol="USDC" width={32} height={32} />
            <Input
              aria-label={t("Repay amount")}
              alignSelf="center"
              backgroundColor="$backgroundSoft"
              borderBottomLeftRadius={0}
              borderBottomRightRadius={0}
              borderWidth={0}
              color="$uiNeutralPrimary"
              cursor="pointer"
              flex={1}
              height="auto"
              inputMode="decimal"
              onBlur={() => {
                setFocused(false);
                const cleanValue = value > 0n ? formatUnits(value, 6).replace(/\.?0+$/, "") : "";
                setEditingValue(cleanValue || undefined);
              }}
              onChangeText={handleAmountChange}
              onFocus={() => setFocused(true)}
              placeholder="0"
              style={{ fontSize: 34, fontWeight: 400, letterSpacing: -0.2 }}
              textAlign="center"
              value={displayValue}
            />
          </XStack>
          <Separator height={1} borderColor={focused ? "$borderBrandStrong" : "$borderNeutralSoft"} />
        </YStack>
        <YStack justifyContent="space-between" flexWrap="wrap" alignItems="flex-start" gap="$s3">
          <Slider
            onValueChange={handleSliderChange}
            value={[Number(clampedValue) / 1e6]}
            width="100%"
            min={0}
            max={Number(totalPositionRepay) / 1e6}
            step={sliderStep}
          >
            <Slider.Track backgroundColor="$backgroundBrandMild">
              <Slider.TrackActive backgroundColor="$uiBrandSecondary" />
            </Slider.Track>
            <Slider.Thumb
              circular
              index={0}
              size={20}
              backgroundColor="$uiBrandSecondary"
              borderColor="$borderBrandStrong"
              hitSlop={100}
              hoverStyle={{ backgroundColor: "$uiBrandSecondary" }}
              pressStyle={{ backgroundColor: "$uiBrandSecondary" }}
              aria-label={t("Repay amount slider")}
              aria-valuetext={`${(Number(clampedValue) / 1e6).toLocaleString(language, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} USDC`}
            />
          </Slider>
          {maxReached && (
            <Text caption color="$uiNeutralSecondary" aria-live="polite">
              {canPayFullDebt ? t("Full repayment selected.") : t("Maximum amount selected.")}
            </Text>
          )}
        </YStack>
        {balancerBalance !== undefined && positionValue > balancerBalance && (
          <Text caption color="$uiNeutralPlaceholder" aria-live="polite">
            {t("Limit {{amount}} per repay. Please split larger amounts into smaller payments.", {
              amount: `$${(Number(balancerBalance) / 1e6).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
            })}
          </Text>
        )}
      </YStack>
    </YStack>
  );
}
