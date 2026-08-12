import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { Separator, XStack, YStack } from "tamagui";

import { formatUnits, parseUnits } from "viem";

import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import Input from "../shared/Input";
import Text from "../shared/Text";

import type { Hex } from "@exactly/common/validation";

export default function AmountSelector({
  value,
  warning,
  onChange,
  market,
}: {
  market: Hex;
  onChange: (value: bigint) => void;
  value: bigint;
  warning: boolean;
}) {
  const { t } = useTranslation();
  const { market: selectedMarket, borrowAvailable } = useAsset(market);
  const [input, setInput] = useState<string>();
  const [focused, setFocused] = useState(false);

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
              symbol={selectedMarket?.symbol.slice(3) === "WETH" ? "ETH" : (selectedMarket?.symbol.slice(3) ?? "")}
              width={32}
              height={32}
            />
            <Input
              aria-label={t("Amount")}
              height="auto"
              inputMode="decimal"
              onChangeText={(text) => {
                setInput(text);
                if (!selectedMarket) return;
                onChange(
                  parseUnits(text.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), selectedMarket.decimals),
                );
              }}
              placeholder="0"
              onFocus={() => {
                setFocused(true);
              }}
              onBlur={() => {
                setFocused(false);
              }}
              value={input ?? (value > 0n && selectedMarket ? formatUnits(value, selectedMarket.decimals) : "")}
              color={warning ? "$interactiveBaseErrorDefault" : "$uiNeutralPrimary"}
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
          <Separator
            height={1}
            borderColor={warning ? "$borderErrorStrong" : focused ? "$borderBrandStrong" : "$borderNeutralSoft"}
          />
        </YStack>
        <XStack gap="$s4" justifyContent="center" flexWrap="wrap" alignItems="center">
          {Array.from({ length: 4 }).map((_, index) => {
            const percentage = index === 0 ? 5 : index * 25;
            const amount = (borrowAvailable * BigInt(percentage)) / 100n;
            const selected = value > 0n && value === amount;
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
                  if (!selectedMarket) return;
                  setInput(formatUnits(amount, selectedMarket.decimals));
                  onChange(amount);
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
