import type { Token } from "@lifi/sdk";
import { Check, X } from "@tamagui/lucide-icons";
import React from "react";
import { Pressable } from "react-native";
import { Square, XStack, YStack } from "tamagui";
import { formatUnits } from "viem";

import TokenLogo from "./TokenLogo";
import GradientScrollView from "../shared/GradientScrollView";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ProcessingView({
  status,
  isError,
  isSuccess,
  isPending,
  preview,
  onClose,
}: {
  status?: string;
  isError: boolean;
  isSuccess: boolean;
  isPending: boolean;
  preview?: { sourceToken: Token; sourceAmount: bigint };
  onClose: () => void;
}) {
  const label = "Transaction";
  return (
    <GradientScrollView variant={isError ? "error" : isSuccess ? "success" : "neutral"}>
      <View flex={1}>
        <YStack gap="$s7" paddingBottom="$s9">
          <Pressable onPress={onClose} disabled={isPending}>
            <X size={24} color={isPending ? "$uiNeutralPlaceholder" : "$uiNeutralPrimary"} />
          </Pressable>

          <YStack gap="$s4_5" justifyContent="center" alignItems="center">
            <Square
              size={80}
              borderRadius="$r4"
              backgroundColor={
                isError
                  ? "$interactiveBaseErrorSoftDefault"
                  : isSuccess
                    ? "$interactiveBaseSuccessSoftDefault"
                    : "$backgroundStrong"
              }
            >
              {isPending && <ExaSpinner backgroundColor="transparent" color="$uiNeutralPrimary" />}
              {isSuccess && <Check size={48} color="$uiSuccessSecondary" strokeWidth={2} />}
              {isError && <X size={48} color="$uiErrorSecondary" strokeWidth={2} />}
            </Square>

            <YStack gap="$s3" justifyContent="center" alignItems="center">
              <Text secondary body>
                {isError ? `${label} failed` : isSuccess ? `${label} submitted` : (status ?? "Processing...")}
              </Text>
            </YStack>

            {preview && (
              <>
                <XStack gap="$s3" alignItems="center">
                  <TokenLogo token={preview.sourceToken} size={32} />
                  <Text title primary color="$uiNeutralPrimary">
                    {`${Number(formatUnits(preview.sourceAmount, preview.sourceToken.decimals)).toLocaleString(
                      undefined,
                      {
                        maximumFractionDigits: Math.min(6, preview.sourceToken.decimals),
                      },
                    )} ${preview.sourceToken.symbol}`}
                  </Text>
                </XStack>
                <Text emphasized secondary body textAlign="center">
                  {(
                    Number(formatUnits(preview.sourceAmount, preview.sourceToken.decimals)) *
                    Number(preview.sourceToken.priceUSD)
                  ).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })}
                </Text>
              </>
            )}
          </YStack>
        </YStack>
      </View>

      {!isPending && (
        <YStack flex={2} justifyContent="flex-end" gap="$s5" alignItems="center" paddingBottom="$s6">
          <Pressable onPress={onClose}>
            <Text emphasized footnote color="$uiBrandSecondary" textAlign="center">
              Close
            </Text>
          </Pressable>
        </YStack>
      )}
    </GradientScrollView>
  );
}
