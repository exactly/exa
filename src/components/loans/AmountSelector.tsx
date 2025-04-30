import type { Hex } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";
import { ArrowDownUp } from "@tamagui/lucide-icons";
import { useForm } from "@tanstack/react-form";
import React, { useCallback, useRef } from "react";
import type { TextInput } from "react-native";
import { styled, XStack, YStack } from "tamagui";
import { nonEmpty, pipe, string } from "valibot";
import { formatUnits, parseUnits } from "viem";

import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import Input from "../shared/Input";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AmountSelector({ onChange, market }: { onChange: (value: bigint) => void; market: Hex }) {
  const usdInputReference = useRef<TextInput>(null);
  const { market: selectedMarket, borrowAvailable } = useAsset(market);
  const { Field, setFieldValue, getFieldValue } = useForm({ defaultValues: { assetInput: "", usdInput: "" } });

  const handleUsdChange = useCallback(
    (text: string) => {
      if (selectedMarket) {
        setFieldValue("usdInput", text);
        const assets =
          (((parseUnits(text.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), 18) * WAD) /
            selectedMarket.usdPrice) *
            BigInt(10 ** selectedMarket.decimals)) /
          WAD;
        setFieldValue("assetInput", assets > 0n ? formatUnits(assets, selectedMarket.decimals) : "");
        onChange(assets);
      }
    },
    [selectedMarket, setFieldValue, onChange],
  );

  const handlePercentage = useCallback(
    (percentage: number) => {
      if (selectedMarket) {
        const amount = (borrowAvailable * BigInt(percentage)) / 100n;
        setFieldValue("assetInput", formatUnits(amount, selectedMarket.decimals));
        const assetsUSD = Number(formatUnits((amount * selectedMarket.usdPrice) / WAD, selectedMarket.decimals));
        setFieldValue("usdInput", assetsUSD.toString());
        onChange(amount);
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
        <Field name="usdInput" validators={{ onChange: pipe(string(), nonEmpty("empty amount")) }}>
          {({ state: { value } }) => {
            const highAmount =
              Number(getFieldValue("assetInput")) >=
              Number(formatUnits((borrowAvailable * 75n) / 100n, selectedMarket?.decimals ?? 0));
            return (
              <View
                onPress={() => {
                  usdInputReference.current?.focus();
                }}
              >
                <AmountInput
                  ref={usdInputReference}
                  inputMode="decimal"
                  onChangeText={handleUsdChange}
                  placeholder="USD"
                  cursor="pointer"
                  value={value}
                  color={highAmount ? "$interactiveBaseErrorDefault" : "$uiNeutralPrimary"}
                />
              </View>
            );
          }}
        </Field>
        <XStack justifyContent="center" alignItems="center" cursor="pointer" hitSlop={15}>
          <ArrowDownUp size={16} color="$interactiveBaseBrandDefault" />
        </XStack>
        <XStack justifyContent="center" alignItems="center" hitSlop={15} gap="$s2">
          <AssetLogo
            uri={
              assetLogos[
                selectedMarket?.symbol.slice(3) === "WETH"
                  ? "ETH"
                  : (selectedMarket?.symbol.slice(3) as keyof typeof assetLogos)
              ]
            }
            width={16}
            height={16}
          />
          <Field name="assetInput" validators={{ onChange: pipe(string(), nonEmpty("empty amount")) }}>
            {({ state: { value } }) => {
              if (!selectedMarket) return null;
              return (
                <Text fontSize={16} color="$uiNeutralPrimary">
                  {Number(value).toLocaleString(undefined, {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 8,
                    useGrouping: false,
                  })}
                </Text>
              );
            }}
          </Field>
        </XStack>
        <XStack gap="$s4" paddingHorizontal="$s4" justifyContent="center" flexWrap="wrap">
          {Array.from({ length: 4 }).map((_, index) => {
            const percentage = index === 0 ? 5 : index * 25;
            const selected =
              selectedMarket && getFieldValue("assetInput")
                ? parseUnits(getFieldValue("assetInput"), selectedMarket.decimals) ===
                  (borrowAvailable * BigInt(percentage)) / 100n
                : false;
            const highAmount = selected && index === 3;
            return (
              <XStack
                key={index}
                borderWidth={1}
                borderRadius="$r_0"
                alignItems="center"
                justifyContent="center"
                paddingVertical="$s2"
                paddingHorizontal="$s4"
                borderColor={
                  selected ? (highAmount ? "$borderErrorStrong" : "$borderBrandStrong") : "$borderNeutralSoft"
                }
                cursor="pointer"
                backgroundColor={
                  selected
                    ? highAmount
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
                      ? highAmount
                        ? "$interactiveOnBaseErrorSoft"
                        : "$interactiveOnBaseBrandSoft"
                      : "$uiNeutralSecondary"
                  }
                  footnote
                  width="100%"
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
const AmountInput = styled(Input, {
  flex: 1,
  height: 60,
  fontSize: 24,
  borderWidth: 0,
  textAlign: "center",
  backgroundColor: "$backgroundSoft",
  focusStyle: { borderColor: "$borderBrandStrong", borderWidth: 1 },
});
