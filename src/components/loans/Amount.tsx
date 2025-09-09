import { previewerAddress } from "@exactly/common/generated/chain";
import { ArrowLeft, ArrowRight, Check, CircleHelp, TriangleAlert } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable } from "react-native";
import { Checkbox, ScrollView, XStack, YStack } from "tamagui";
import { formatUnits, zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import AmountSelector from "./AmountSelector";
import type { AppNavigationProperties } from "../../app/(app)/_layout";
import { useReadPreviewerExactly } from "../../generated/contracts";
import type { Loan } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Amount() {
  const navigation = useNavigation<AppNavigationProperties>();
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

  const [state, setState] = useState<{ amount: bigint; warning: boolean }>({
    amount: loan?.amount ?? 0n,
    warning: false,
  });

  const insufficient = Number(state.amount) > borrowAvailable;
  const disabled = !loan?.market || state.amount <= 0n || insufficient || (state.warning && !acknowledged);

  useEffect(() => {
    return () => {
      queryClient.setQueryData<Loan>(["loan"], undefined);
    };
  }, []);
  return (
    <SafeView fullScreen>
      <View padded flexDirection="row" gap={10} paddingBottom="$s4" justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            queryClient.setQueryData(["loan"], (old: Loan) => ({ ...old, amount: null }));
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            queryClient.resetQueries({ queryKey: ["loan"] }).catch(reportError);
            navigation.replace("(home)", { screen: "loans" });
          }}
        >
          <ArrowLeft size={24} color="$uiNeutralPrimary" />
        </Pressable>
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
                  Select amount
                </Text>
                {markets && market && loan?.market && (
                  <XStack alignItems="center" gap="$s2">
                    <Text footnote color="$uiNeutralPlaceholder">
                      Available funding:&nbsp;
                      {Number(formatUnits(borrowAvailable, market.decimals)).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
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
                  onChange={(amount, warning) => {
                    setState({ amount, warning });
                    setAcknowledged(false);
                  }}
                />
              )}
              {insufficient && (
                <XStack gap="$s3" flex={1} alignItems="center">
                  <TriangleAlert size={16} color="$uiErrorSecondary" />
                  <Text secondary caption flex={1}>
                    You&apos;re trying to borrow more than your collateral allows. Please enter a lower amount.
                  </Text>
                </XStack>
              )}
            </YStack>
          </YStack>
          <YStack gap="$s4_5">
            {state.warning && !insufficient && (
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
                    <Check size={16} color="white" />
                  </Checkbox.Indicator>
                </Checkbox>
                <Text secondary caption flex={1}>
                  I acknowledge the risks of borrowing this much against my collateral.
                </Text>
              </XStack>
            )}
            <Button
              onPress={() => {
                queryClient.setQueryData(["loan"], (old: Loan) => ({ ...old, amount: state.amount }));
                navigation.navigate("loan", { screen: "installments" });
              }}
              primary={!state.warning || !acknowledged}
              dangerSecondary={state.warning && acknowledged}
              disabled={disabled}
            >
              <Button.Text>Continue</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
          </YStack>
        </YStack>
      </ScrollView>
    </SafeView>
  );
}
