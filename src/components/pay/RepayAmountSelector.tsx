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
  decimals,
  symbol,
}: {
  balancerBalance: bigint | undefined;
  decimals: number;
  maxRepayInput: bigint;
  onChange: (value: bigint) => void;
  positionValue: bigint;
  symbol?: string;
  totalPositionRepay: bigint;
  value: bigint;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [editingValue, setEditingValue] = useState<string | undefined>();

  const displayValue = editingValue ?? formatUnits(value, decimals);
  const canPayFullDebt = maxRepayInput >= totalPositionRepay && totalPositionRepay > 0n;
  const effectiveMax = canPayFullDebt ? totalPositionRepay : maxRepayInput;
  const clampedValue = min(value, effectiveMax);
  const maxReached = clampedValue >= effectiveMax && effectiveMax > 0n;

  const sliderStep = useMemo(() => {
    const maxValue = Number(totalPositionRepay) / 10 ** decimals;
    const step = maxValue / 100;
    return Math.max(10 ** -decimals, Number(step.toPrecision(2)));
  }, [totalPositionRepay, decimals]);

  const handleAmountChange = useCallback(
    (input: string) => {
      setEditingValue(input);
      const inputAmount = parseAmount(input, decimals);
      if (inputAmount > effectiveMax) {
        onChange(effectiveMax);
        setEditingValue(formatUnits(effectiveMax, decimals));
      } else {
        onChange(inputAmount);
      }
    },
    [onChange, effectiveMax, decimals],
  );

  const handleSliderChange = useCallback(
    (values: number[]) => {
      if (values[0] === undefined) return;
      const sliderValue = values[0];
      setEditingValue(undefined);
      if (sliderValue >= Number(effectiveMax) / 10 ** decimals) {
        onChange(effectiveMax);
      } else {
        const sliderAmount = parseAmount(sliderValue.toFixed(decimals), decimals);
        onChange(sliderAmount);
      }
    },
    [onChange, effectiveMax, decimals],
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
          hitSlop={15}
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
            <AssetLogo symbol={symbol} width={32} height={32} />
            <AmountInput
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
              decimals={decimals}
              onBlur={() => {
                setFocused(false);
                setEditingValue(value > 0n ? formatUnits(value, decimals) : undefined);
              }}
              onChangeText={handleAmountChange}
              onFocus={(event) => {
                setFocused(true);
                if (Platform.OS === "web" && "select" in event.currentTarget) event.currentTarget.select();
              }}
              placeholder="0"
              selectTextOnFocus
              fontSize={34}
              fontWeight="400"
              letterSpacing={-0.2}
              textAlign="center"
              value={displayValue}
            />
          </XStack>
          <Separator height={1} borderColor={focused ? "$borderBrandStrong" : "$borderNeutralSoft"} />
        </YStack>
        <YStack justifyContent="space-between" flexWrap="wrap" alignItems="flex-start" gap="$s3">
          <Slider
            onValueChange={handleSliderChange}
            value={[Number(clampedValue) / 10 ** decimals]}
            width="100%"
            min={0}
            max={Number(totalPositionRepay) / 10 ** decimals}
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
              hitSlop={10}
              hoverStyle={{ backgroundColor: "$uiBrandSecondary" }}
              pressStyle={{ backgroundColor: "$uiBrandSecondary" }}
              aria-label={t("Repay amount slider")}
              aria-valuetext={`${(Number(clampedValue) / 10 ** decimals).toLocaleString(language, {
                minimumFractionDigits: 2,
                maximumFractionDigits: symbol === "USDC" ? 2 : 8,
              })} ${symbol}`}
            />
          </Slider>
          {maxReached && (
            <Text caption color="$uiNeutralSecondary" aria-live="polite">
              {canPayFullDebt ? t("Full repayment selected.") : t("Maximum amount selected.")}
            </Text>
          )}
        </YStack>
        {balancerBalance === 0n ? (
          <Text caption color="$uiNeutralPlaceholder" aria-live="polite">
            {t("Repaying {{symbol}} from your portfolio is not available yet.", { symbol })}
          </Text>
        ) : (
          balancerBalance !== undefined &&
          positionValue > balancerBalance && (
            <Text caption color="$uiNeutralPlaceholder" aria-live="polite">
              {t("Limit {{amount}} per repay. Please split larger amounts into smaller payments.", {
                amount: `${(Number(balancerBalance) / 10 ** decimals).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: symbol === "USDC" ? 2 : 8 })} ${symbol}`,
              })}
            </Text>
          )
        )}
      </YStack>
    </YStack>
  );
}
