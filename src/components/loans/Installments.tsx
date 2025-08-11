import { ArrowLeft, ArrowRight, CircleHelp } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React, { useEffect } from "react";
import { Pressable } from "react-native";
import { ScrollView, YStack } from "tamagui";
import { useAccount } from "wagmi";

import LoanSummary from "./LoanSummary";
import type { AppNavigationProperties } from "../../app/(app)/_layout";
import type { Loan } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import InstallmentSelector from "../shared/InstallmentSelector";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Installments() {
  const navigation = useNavigation<AppNavigationProperties>();
  const { presentArticle } = useIntercom();
  const { address } = useAccount();
  const { data: loan } = useQuery<Loan>({ queryKey: ["loan"], enabled: !!address });
  const disabled = !loan?.installments;

  useEffect(() => {
    return () => {
      queryClient.setQueryData<Loan>(["loan"], (old) => {
        return { ...old, installments: undefined, maturity: undefined, receiver: undefined };
      });
    };
  }, []);
  return (
    <SafeView fullScreen>
      <View padded flexDirection="row" gap={10} paddingBottom="$s4" justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            navigation.replace("loan", { screen: "amount" });
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
              <YStack gap="$s4_5">
                <Text primary emphasized body>
                  Select your funding installment plan
                </Text>
                {loan?.market && loan.amount && (
                  <InstallmentSelector
                    value={loan.installments ?? 0}
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
        </YStack>
      </ScrollView>
      <YStack gap="$s4" padding="$s4" backgroundColor="$backgroundSoft">
        {loan?.installments && <LoanSummary loan={loan} />}
        <Button
          onPress={() => {
            navigation.navigate("loan", { screen: "maturity" });
          }}
          primary
          disabled={disabled}
        >
          <Button.Text>Continue</Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
      </YStack>
    </SafeView>
  );
}
