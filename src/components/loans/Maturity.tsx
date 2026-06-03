import React from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Check, CircleHelp } from "@tamagui/lucide-icons-2";
import { ScrollView, XStack, YStack } from "tamagui";

import { parse } from "valibot";

import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { MATURITY_INTERVAL } from "@exactly/lib";

import LoanSummary from "./LoanSummary";
import { presentArticle } from "../../utils/intercom";
import Loan from "../../utils/Loan";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Maturity() {
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { market, amount, installments, maturity } = parse(Loan, useLocalSearchParams());
  const { market: asset, markets, firstMaturity } = useAsset(market);

  if (!market || !amount || !installments || (markets && !asset)) return <Redirect href="/loan" />;
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
            router.replace({
              pathname: "/loan/installments",
              params: { market, amount: String(amount), installments: String(installments) },
            });
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
        <YStack gap="$s4" justifyContent="space-between">
          <YStack gap="$s4" padding="$s4">
            <YStack gap="$s4_5">
              <YStack gap="$s4_5">
                <Text primary emphasized body>
                  {t("Select first due date")}
                </Text>
                <YStack gap="$s3">
                  {Array.from({ length: MAX_INSTALLMENTS }).map((_, index) => {
                    const option = firstMaturity + index * MATURITY_INTERVAL;
                    const selected = option === Number(maturity);
                    const invalid = index + installments > MAX_INSTALLMENTS;
                    return (
                      <XStack
                        key={option}
                        onPress={() => {
                          if (invalid) return;
                          router.setParams({ maturity: String(option) });
                        }}
                        flex={1}
                        gap="$s4"
                        minHeight={60}
                        backgroundColor={
                          selected
                            ? "$interactiveBaseBrandSoftDefault"
                            : invalid
                              ? "$interactiveDisabled"
                              : "$backgroundSoft"
                        }
                        borderRadius="$r4"
                        alignItems="center"
                        padding="$s4"
                        paddingVertical="$s4_5"
                        cursor={invalid ? "not-allowed" : "pointer"}
                      >
                        <XStack
                          backgroundColor={selected ? "$interactiveBaseBrandDefault" : "$backgroundStrong"}
                          width={20}
                          height={20}
                          borderRadius={12}
                          alignItems="center"
                          justifyContent="center"
                        >
                          {selected && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
                        </XStack>
                        <YStack>
                          <Text headline color={invalid ? "$interactiveOnDisabled" : "$uiNeutralPrimary"}>
                            {new Date(option * 1000).toLocaleDateString(language, {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </Text>
                          {invalid ? (
                            <Text footnote color="$uiNeutralPlaceholder">
                              {t("Available for {{count}} installments or less", { count: MAX_INSTALLMENTS - index })}
                            </Text>
                          ) : null}
                        </YStack>
                      </XStack>
                    );
                  })}
                </YStack>
              </YStack>
            </YStack>
          </YStack>
        </YStack>
      </ScrollView>
      <YStack gap="$s4" padding="$s4" backgroundColor="$backgroundSoft">
        <LoanSummary market={market} amount={amount} installments={installments} maturity={maturity} />
        <Button
          onPress={() => {
            router.push({
              pathname: "/loan/receiver",
              params: {
                market,
                amount: String(amount),
                installments: String(installments),
                maturity: String(maturity),
              },
            });
          }}
          primary
          disabled={!maturity}
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
