import React from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, CircleHelp } from "@tamagui/lucide-icons-2";
import { ScrollView, YStack } from "tamagui";

import { parse } from "valibot";

import LoanSummary from "./LoanSummary";
import { presentArticle } from "../../utils/intercom";
import Loan from "../../utils/Loan";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import IconButton from "../shared/IconButton";
import InstallmentSelector from "../shared/InstallmentSelector";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Installments() {
  const router = useRouter();
  const { t } = useTranslation();
  const { market, amount, installments } = parse(Loan, useLocalSearchParams());
  const { market: asset, markets } = useAsset(market);

  if (!market || !amount || (markets && !asset)) return <Redirect href="/loan" />;
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
        <IconButton
          icon={ArrowLeft}
          aria-label={t("Back")}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }
            router.replace({ pathname: "/loan/amount", params: { market, amount: String(amount) } });
          }}
        />
        <IconButton
          icon={CircleHelp}
          aria-label={t("Help")}
          onPress={() => {
            presentArticle("11541409").catch(reportError);
          }}
        />
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
                <InstallmentSelector
                  value={installments ?? 0}
                  onSelect={(value) => {
                    router.setParams({ installments: String(value) });
                  }}
                  totalAmount={amount}
                  market={market}
                />
              </YStack>
            </YStack>
          </YStack>
        </YStack>
      </ScrollView>
      <YStack gap="$s4" padding="$s4" backgroundColor="$backgroundSoft">
        {installments ? <LoanSummary market={market} amount={amount} installments={installments} /> : null}
        <Button
          onPress={() => {
            router.push({
              pathname: "/loan/maturity",
              params: { market, amount: String(amount), installments: String(installments) },
            });
          }}
          primary
          disabled={!installments}
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
