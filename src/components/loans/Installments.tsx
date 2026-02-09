import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, CircleHelp } from "@tamagui/lucide-icons";
import { ScrollView, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import LoanSummary from "./LoanSummary";
import { presentArticle } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import InstallmentSelector from "../shared/InstallmentSelector";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Loan } from "../../utils/queryClient";

export default function Installments() {
  const router = useRouter();
  const { t } = useTranslation();
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
      <View
        padded
        flexDirection="row"
        gap="$s3_5"
        paddingBottom="$s4"
        justifyContent="space-between"
        alignItems="center"
      >
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }
            router.replace("/loan/amount");
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
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <YStack padding="$s4" gap="$s4" flex={1} justifyContent="space-between">
          <YStack gap="$s4">
            <YStack gap="$s6">
              <YStack gap="$s4_5">
                <Text primary emphasized body>
                  {t("Select your funding installment plan")}
                </Text>
                {loan?.market && loan.amount ? (
                  <InstallmentSelector
                    value={loan.installments ?? 0}
                    onSelect={(installments) => {
                      queryClient.setQueryData<Loan>(["loan"], (old) => ({ ...old, installments }));
                    }}
                    totalAmount={loan.amount}
                    market={loan.market}
                  />
                ) : null}
              </YStack>
            </YStack>
          </YStack>
        </YStack>
      </ScrollView>
      <YStack gap="$s4" padding="$s4" backgroundColor="$backgroundSoft">
        {loan?.installments ? <LoanSummary loan={loan} /> : null}
        <Button
          onPress={() => {
            router.push("/loan/maturity");
          }}
          primary
          disabled={disabled}
        >
          <Button.Text>{t("Continue")}</Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
      </YStack>
    </SafeView>
  );
}
