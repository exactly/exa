import { ArrowLeft, ArrowRight, CircleHelp } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView, YStack } from "tamagui";
import { useAccount } from "wagmi";

import type { Loan } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import InstallmentSelector from "../shared/InstallmentSelector";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Installments() {
  const { canGoBack } = router;
  const { presentArticle } = useIntercom();
  const { address } = useAccount();
  const { data: loan } = useQuery<Loan>({ queryKey: ["loan"], enabled: !!address });
  const disabled = !loan?.amount;
  return (
    <SafeView fullScreen>
      <View padded flexDirection="row" gap={10} paddingBottom="$s4" justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            if (canGoBack()) {
              router.back();
              return;
            }
            router.replace("/loan/amount");
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
              <YStack gap="$s4_5">
                <Text primary emphasized body>
                  Select your loan installment plan
                </Text>
                {loan?.market && loan.amount && (
                  <InstallmentSelector
                    value={loan.installments}
                    onSelect={(installments) => {
                      queryClient.setQueryData(["loan"], (old: Loan) => ({ ...old, installments }));
                    }}
                    totalAmount={loan.amount}
                    market={loan.market}
                  />
                )}
              </YStack>
            </YStack>
          </YStack>
          <YStack>
            <Button
              onPress={() => {
                router.push("/(app)/loan/maturity");
              }}
              main
              spaced
              outlined
              disabled={disabled}
              backgroundColor={disabled ? "$interactiveDisabled" : "$interactiveBaseBrandSoftDefault"}
              color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandSoft"}
              iconAfter={
                <ArrowRight
                  color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandSoft"}
                  strokeWidth={2.5}
                />
              }
              flex={0}
            >
              Continue
            </Button>
          </YStack>
        </YStack>
      </ScrollView>
    </SafeView>
  );
}
