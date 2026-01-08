import { min } from "@exactly/lib";
import React, { useCallback, useMemo, useState } from "react";
import { Separator, Slider, XStack, YStack } from "tamagui";
import { formatUnits, parseUnits } from "viem";

import assetLogos from "../../utils/assetLogos";
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
  value: bigint;
  onChange: (value: bigint) => void;
  maxRepayInput: bigint;
  totalPositionRepay: bigint;
  balancerBalance: bigint;
  positionValue: bigint;
}) {
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
        <Text emphasized subHeadline color="$uiBrandSecondary" onPress={handleMaxPress} cursor="pointer">
          Max
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
            <AssetLogo source={{ uri: assetLogos.USDC }} width={32} height={32} />
            <Input
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
                const cleanValue = value > 0n ? String(Number(formatUnits(value, 6))) : "";
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
            />
          </Slider>
          {maxReached && (
            <Text caption color="$uiNeutralSecondary">
              {canPayFullDebt ? "Full repayment selected." : "Maximum amount selected."}
            </Text>
          )}
        </YStack>
        {positionValue > balancerBalance && (
          <Text caption color="$uiNeutralPlaceholder">
            Limit&nbsp;
            {(Number(balancerBalance) / 1e6).toLocaleString(undefined, {
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
