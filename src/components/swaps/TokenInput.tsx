import type { Token } from "@lifi/sdk";
import { Skeleton } from "moti/skeleton";
import React from "react";
import { Appearance, Image, Pressable } from "react-native";
import { styled, XStack, YStack } from "tamagui";
import { formatUnits } from "viem";

import Input from "../shared/Input";
import Text from "../shared/Text";

interface TokenInputCardProperties {
  label: string;
  token: Token | null;
  amount: string;
  balance?: bigint;
  usdValue: number;
  onTokenSelect: () => void;
  onAmountChange: (value: string) => void;
  isEditable?: boolean;
  isLoading?: boolean;
}

export default function TokenInput({
  label,
  token,
  amount,
  usdValue,
  balance,
  onTokenSelect,
  onAmountChange,
  isEditable = true,
  isLoading = false,
}: TokenInputCardProperties) {
  return (
    <YStack borderWidth={1} borderColor="$borderNeutralSoft" borderRadius="$r3" padding="$s4_5" gap="$s4_5">
      <Text emphasized footnote color="$uiNeutralSecondary">
        {label}
      </Text>

      <XStack gap="$s3_5" alignItems="center">
        <Pressable onPress={onTokenSelect}>
          {isLoading || !token ? (
            <Skeleton radius="round" colorMode={Appearance.getColorScheme() ?? "light"} height={40} width={40} />
          ) : (
            <XStack alignItems="center" gap="$s2">
              <Image
                source={{
                  uri: token.logoURI,
                }}
                width={40}
                height={40}
                borderRadius={16}
              />
            </XStack>
          )}
        </Pressable>

        <YStack flex={1} gap="$s2">
          <XStack alignItems="center" gap="$s2">
            <AmountInput
              value={amount}
              onChangeText={onAmountChange}
              editable={isEditable}
              placeholderTextColor={isEditable ? "$uiNeutralPrimary" : "$uiNeutralPlaceholder"}
            />

            {token && (
              <Text subHeadline color="$uiNeutralPlaceholder">
                / {balance ? Number(formatUnits(balance, token.decimals)).toFixed(4) : "0"}
              </Text>
            )}
          </XStack>

          <XStack flexDirection="row" alignItems="center" paddingHorizontal="$s3">
            <Text callout color="$uiNeutralPlaceholder">
              {usdValue > 0 && "≈"}
              {usdValue.toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                currencyDisplay: "narrowSymbol",
              })}
            </Text>
          </XStack>
        </YStack>
      </XStack>
    </YStack>
  );
}

const AmountInput = styled(Input, {
  flex: 1,
  padding: 0,
  unstyled: true,
  fontSize: 28,
  letterSpacing: -0.2,
  textAlign: "left",
  inputMode: "decimal",
  paddingVertical: "$s2",
  paddingHorizontal: "$s3",
  placeholder: "0.00",
  cursor: "pointer",
  numberOfLines: 1,
  focusStyle: { borderColor: "$borderBrandStrong", borderWidth: 1 },
});
