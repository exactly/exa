import type { Hex } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";
import { useForm } from "@tanstack/react-form";
import React, { useCallback } from "react";
import { styled, XStack, YStack } from "tamagui";
import { nonEmpty, pipe, string } from "valibot";
import { formatUnits, parseUnits } from "viem";

import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import Input from "../shared/Input";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AmountSelector({
  onChange,
  market,
}: {
  onChange: (value: bigint, highAmount: boolean) => void;
  market: Hex;
}) {
  const { market: selectedMarket, borrowAvailable } = useAsset(market);
  const { Field, setFieldValue, getFieldValue } = useForm({ defaultValues: { assetInput: "", usdInput: "" } });

  const highAmount =
    Number(getFieldValue("assetInput")) >=
    Number(formatUnits((borrowAvailable * 75n) / 100n, selectedMarket?.decimals ?? 0));

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
        const newHighAmount =
          Number(formatUnits(assets, selectedMarket.decimals)) >=
          Number(formatUnits((borrowAvailable * 75n) / 100n, selectedMarket.decimals));
        onChange(assets, newHighAmount);
      }
    },
    [selectedMarket, setFieldValue, onChange, borrowAvailable],
  );

  const handlePercentage = useCallback(
    (percentage: number) => {
      if (selectedMarket) {
        const amount = (borrowAvailable * BigInt(percentage)) / 100n;
        setFieldValue("assetInput", formatUnits(amount, selectedMarket.decimals));
        const assetsUSD = Number(formatUnits((amount * selectedMarket.usdPrice) / WAD, selectedMarket.decimals));
        setFieldValue("usdInput", assetsUSD.toString());
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
        <Field name="usdInput" validators={{ onChange: pipe(string(), nonEmpty("empty amount")) }}>
          {({ state: { value } }) => {
            return (
              <View alignSelf="center" width="80%">
                <AmountInput
                  inputMode="decimal"
                  onChangeText={handleUsdChange}
                  placeholder={(0).toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                    style: "currency",
                    currency: "USD",
                  })}
                  value={value}
                  color={highAmount ? "$interactiveBaseErrorDefault" : "$uiNeutralPrimary"}
                />
              </View>
            );
          }}
        </Field>
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
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 8,
                    useGrouping: false,
                  })}
                </Text>
              );
            }}
          </Field>
        </XStack>
        <XStack gap="$s4" justifyContent="center" flexWrap="wrap" alignItems="center">
          {Array.from({ length: 4 }).map((_, index) => {
            const percentage = index === 0 ? 5 : index * 25;
            const selected =
              selectedMarket && getFieldValue("assetInput")
                ? parseUnits(getFieldValue("assetInput"), selectedMarket.decimals) ===
                  (borrowAvailable * BigInt(percentage)) / 100n
                : false;
            const danger = selected && index === 3;
            return (
              <XStack
                key={index}
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
const AmountInput = styled(Input, {
  flex: 1,
  width: "100%",
  alignSelf: "center",
  height: 60,
  borderWidth: 0,
  fontSize: 34,
  fontWeight: 400,
  lineHeight: 41,
  letterSpacing: -0.2,
  cursor: "pointer",
  textAlign: "center",
  backgroundColor: "$backgroundSoft",
  borderBottomColor: "$borderNeutralSoft",
  borderBottomWidth: 1,
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0,
  focusStyle: { borderBottomColor: "$borderBrandStrong" },
});
