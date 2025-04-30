import { previewerAddress } from "@exactly/common/generated/chain";
import { WAD } from "@exactly/lib";
import { ArrowLeft, ArrowRight, Check, CircleHelp } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable } from "react-native";
import { Checkbox, ScrollView, XStack, YStack } from "tamagui";
import { formatUnits, zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import AmountSelector from "./AmountSelector";
import { useReadPreviewerExactly } from "../../generated/contracts";
import type { Loan } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Amount() {
  const { canGoBack } = router;
  const { presentArticle } = useIntercom();
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: markets } = useReadPreviewerExactly({
    address: previewerAddress,
    args: [address ?? zeroAddress],
    query: { enabled: !!bytecode && !!address },
  });
  const { data: loan } = useQuery<Loan>({ queryKey: ["loan"], enabled: !!address });
  const { market, borrowAvailable } = useAsset(loan?.market);

  const [acknowledged, setAcknowledged] = useState(false);
  const [state, setState] = useState<{ amount: bigint; danger: boolean }>({
    amount: loan?.amount ?? 0n,
    danger: false,
  });

  const disabled =
    !loan?.market || state.amount <= 0n || state.amount > borrowAvailable || (state.danger && !acknowledged);
  return (
    <SafeView fullScreen>
      <View padded flexDirection="row" gap={10} paddingBottom="$s4" justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            if (canGoBack()) {
              router.back();
              return;
            }
            queryClient.resetQueries({ queryKey: ["loan"] }).catch(reportError);
            router.replace("/loans");
          }}
        >
          <ArrowLeft size={24} color="$uiNeutralPrimary" />
        </Pressable>
        <Text primary emphasized subHeadline>
          Estimate loan terms
        </Text>
        <Pressable
          onPress={() => {
            presentArticle("11541409").catch(reportError);
          }}
        >
          <CircleHelp color="$uiNeutralPrimary" />
        </Pressable>
      </View>
      <ScrollView
        backgroundColor="$backgroundMild"
        showsVerticalScrollIndicator={false}
        // eslint-disable-next-line react-native/no-inline-styles
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <YStack padding="$s4" gap="$s4" flex={1} justifyContent="space-between">
          <YStack gap="$s4">
            <YStack gap="$s6">
              <YStack gap="$s3_5">
                <Text primary emphasized body>
                  Select amount to borrow
                </Text>
                {markets && market && loan?.market && (
                  <XStack alignItems="center" gap="$s2">
                    <Text footnote color="$uiNeutralPlaceholder">
                      Available credit limit:{" "}
                      {Number(formatUnits((borrowAvailable * market.usdPrice) / WAD, market.decimals)).toLocaleString(
                        undefined,
                        {
                          style: "currency",
                          currency: "USD",
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        },
                      )}
                    </Text>
                    <Pressable
                      onPress={() => {
                        presentArticle("11550408").catch(reportError);
                      }}
                    >
                      <CircleHelp size={16} color="$uiNeutralSecondary" />
                    </Pressable>
                  </XStack>
                )}
              </YStack>
              {loan?.market && (
                <AmountSelector
                  market={loan.market}
                  onChange={(amount, danger) => {
                    setState({ amount, danger });
                    setAcknowledged(false);
                  }}
                />
              )}
            </YStack>
          </YStack>
          <YStack gap="$s4_5">
            {state.danger && (
              <XStack
                gap="$s3"
                flex={1}
                alignItems="center"
                cursor="pointer"
                onPress={() => {
                  setAcknowledged(!acknowledged);
                }}
              >
                <Checkbox
                  pointerEvents="none"
                  borderColor="$backgroundBrand"
                  backgroundColor={acknowledged ? "$backgroundBrand" : "transparent"}
                  checked={acknowledged}
                >
                  <Checkbox.Indicator>
                    <Check size={16} color="$uiNeutralPrimary" />
                  </Checkbox.Indicator>
                </Checkbox>
                <Text secondary caption>
                  I acknowledge the risks of borrowing this much against my collateral.
                </Text>
              </XStack>
            )}
            <Button
              onPress={() => {
                queryClient.setQueryData(["loan"], (old: Loan) => ({ ...old, amount: state.amount }));
                router.push("/(app)/loan/installments");
              }}
              main
              spaced
              outlined
              flex={0}
              danger={state.danger}
              disabled={disabled}
              iconAfter={
                <ArrowRight
                  // eslint-disable-next-line react-native/no-inline-styles, react-native/no-color-literals
                  pressStyle={{
                    color: disabled
                      ? "$interactiveOnDisabled"
                      : state.danger
                        ? "$interactiveOnBaseErrorSoft"
                        : "$interactiveOnBaseBrandSoft",
                  }}
                  color={
                    disabled
                      ? "$interactiveOnDisabled"
                      : state.danger
                        ? "$interactiveOnBaseErrorSoft"
                        : "$interactiveOnBaseBrandSoft"
                  }
                  strokeWidth={2.5}
                />
              }
            >
              Continue
            </Button>
          </YStack>
        </YStack>
      </ScrollView>
    </SafeView>
  );
}
