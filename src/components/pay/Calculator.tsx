import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft } from "@tamagui/lucide-icons-2/icons/ArrowLeft";
import { CircleHelp } from "@tamagui/lucide-icons-2/icons/CircleHelp";
import { ScrollView, XStack, YStack } from "tamagui";

import { formatUnits } from "viem";

import { presentArticle } from "../../utils/intercom";
import parseAmount from "../../utils/parseAmount";
import reportError from "../../utils/reportError";
import useInstallmentRates from "../../utils/useInstallmentRates";
import AmountInput from "../shared/AmountInput";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Calculator() {
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [input, setInput] = useState("100");
  const assets = useMemo(() => parseAmount(input, 6), [input]);
  const rates = useInstallmentRates(assets);

  const bestRateIndex = useMemo(() => {
    if (!rates) return;
    let minIndex: number | undefined;
    for (let index = 0; index < rates.installments.length; index++) {
      if (!rates.installments[index]?.payments) continue;
      if (
        minIndex === undefined ||
        (rates.installments[index]?.rate ?? 0n) < (rates.installments[minIndex]?.rate ?? 0n)
      )
        minIndex = index;
    }
    return minIndex !== undefined && (rates.installments[minIndex]?.rate ?? 0n) > 0n ? minIndex : undefined;
  }, [rates]);
  const firstMaturityLabel = useMemo(
    () =>
      rates
        ? new Date(rates.firstMaturity * 1000).toLocaleDateString(language, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })
        : undefined,
    [rates, language],
  );

  return (
    <SafeView fullScreen backgroundColor="backgroundSoft" paddingBottom={0}>
      <View fullScreen backgroundColor="backgroundMild">
        <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="backgroundSoft" />
        <ScrollView
          backgroundColor="transparent"
          contentContainerStyle={{ backgroundColor: "backgroundMild" }}
          showsVerticalScrollIndicator={false}
          flex={1}
        >
          <View
            backgroundColor="backgroundSoft"
            flexDirection="row"
            gap="s3_5"
            paddingBottom="s4"
            justifyContent="space-between"
            alignItems="center"
            padded
          >
            <Pressable
              accessibilityLabel={t("Go back")}
              accessibilityRole="button"
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.dismissTo("/(main)/(home)");
                }
              }}
            >
              <ArrowLeft size={24} color="uiNeutralPrimary" />
            </Pressable>
            <Text subHeadline emphasized>
              {t("Installments calculator")}
            </Text>
            <Pressable
              aria-label={t("Help")}
              role="button"
              onPress={() => {
                presentArticle("11541409").catch(reportError);
              }}
            >
              <CircleHelp color="uiNeutralSecondary" />
            </Pressable>
          </View>
          <View backgroundColor="backgroundSoft" paddingHorizontal="s4" paddingBottom="s4" paddingTop="s3">
            <XStack gap="s4" alignItems="center">
              <YStack flexShrink={1}>
                <Text emphasized subHeadline>
                  {t("Enter a purchase amount")}
                </Text>
                <Text caption2 secondary>
                  {t("to estimate installment options")}
                </Text>
              </YStack>
              <XStack
                flex={1}
                backgroundColor="backgroundSoft"
                borderColor="borderNeutralSoft focus:borderBrandStrong focus-visible:borderBrandStrong"
                borderRadius="r2"
                borderWidth={1}
                alignItems="center"
                gap="s2"
                paddingHorizontal="s3"
                overflow="hidden"
                outlineWidth="focus-visible:0px"
                outlineColor="focus-visible:borderBrandStrong"
              >
                <Text subHeadline color="uiNeutralPlaceholder">
                  $
                </Text>
                <AmountInput
                  aria-label={t("Amount")}
                  borderWidth={0}
                  decimals={6}
                  maxLength={6}
                  numberOfLines={1}
                  onChangeText={setInput}
                  onFocus={(event) => {
                    if (Platform.OS === "web" && "select" in event.currentTarget) event.currentTarget.select();
                  }}
                  selectTextOnFocus
                  fontSize={20}
                  padding={0}
                  textAlign="right"
                  value={input}
                  flex={1}
                />
              </XStack>
            </XStack>
          </View>
          <YStack paddingTop="s6" paddingBottom="s7" paddingHorizontal="s4" gap="s4_5">
            <YStack gap="s3">
              {rates?.installments.map(({ count, payments, rate, total }) => {
                const isBestRate = bestRateIndex === count - 1;
                return (
                  <XStack
                    key={count}
                    backgroundColor="backgroundSoft"
                    borderRadius="r3"
                    paddingHorizontal="s4"
                    paddingVertical="s4_5"
                    alignItems="center"
                    gap="s3_5"
                  >
                    <YStack flex={1} gap="s3" justifyContent="center">
                      {payments ? (
                        <Text headline>
                          <Text headline color="uiNeutralSecondary">
                            {count}x{" "}
                          </Text>
                          $
                          {Number(formatUnits(payments[0] ?? 0n, 6)).toLocaleString(language, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </Text>
                      ) : (
                        <Skeleton height={23} width={120} />
                      )}
                      <XStack gap="s3" alignItems="center">
                        {payments ? (
                          <Text footnote color={isBestRate ? "interactiveOnBaseSuccessSoft" : "uiNeutralSecondary"}>
                            {t("{{rate}} APR", {
                              rate: (Number(rate) / 1e18).toLocaleString(language, {
                                style: "percent",
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }),
                            })}
                          </Text>
                        ) : (
                          <Skeleton height={12} width={48} />
                        )}
                        {isBestRate && (
                          <YStack
                            backgroundColor="interactiveBaseSuccessDefault"
                            borderRadius={4}
                            paddingHorizontal="s2"
                            paddingVertical="s1"
                          >
                            <Text caption2 emphasized color="interactiveOnBaseSuccessDefault">
                              {t("BEST APR")}
                            </Text>
                          </YStack>
                        )}
                      </XStack>
                    </YStack>
                    {payments ? (
                      <Text title3>
                        $
                        {Number(formatUnits(total, 6)).toLocaleString(language, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    ) : (
                      <Skeleton height={27} width={80} />
                    )}
                  </XStack>
                );
              })}
            </YStack>
            {rates && (
              <Text caption color="uiNeutralSecondary">
                {t("First due date: {{date}} - then every 28 days.", {
                  date: firstMaturityLabel,
                })}
              </Text>
            )}
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}
