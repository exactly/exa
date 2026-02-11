import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, CircleHelp } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { formatUnits, parseUnits } from "viem";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useInstallmentRates from "../../utils/useInstallmentRates";
import Input from "../shared/Input";
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
  const assets = useMemo(() => parseUnits(input.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), 6), [input]);
  const data = useInstallmentRates(assets);

  const bestRateIndex = useMemo(() => {
    if (!data) return;
    let minIndex = 0;
    for (let index = 1; index < data.installments.length; index++) {
      if ((data.installments[index]?.rate ?? 0n) < (data.installments[minIndex]?.rate ?? 0n)) minIndex = index;
    }
    return minIndex;
  }, [data]);

  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft" paddingBottom={0}>
      <View fullScreen backgroundColor="$backgroundMild">
        <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="$backgroundSoft" />
        <ScrollView
          backgroundColor="transparent"
          contentContainerStyle={{ backgroundColor: "$backgroundMild" }}
          showsVerticalScrollIndicator={false}
          flex={1}
        >
          <View
            backgroundColor="$backgroundSoft"
            padded
            flexDirection="row"
            gap="$s3_5"
            paddingBottom="$s4"
            justifyContent="space-between"
            alignItems="center"
          >
            <Pressable
              accessibilityLabel={t("Go back")}
              accessibilityRole="button"
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(main)/(home)");
                }
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
            <Text subHeadline emphasized>
              {t("Installments calculator")}
            </Text>
            <Pressable
              onPress={() => {
                presentArticle("11541409").catch(reportError);
              }}
            >
              <CircleHelp color="$uiNeutralSecondary" />
            </Pressable>
          </View>
          <View backgroundColor="$backgroundSoft" paddingHorizontal="$s4" paddingBottom="$s4" paddingTop="$s3">
            <XStack gap="$s4" alignItems="center">
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
                backgroundColor="$backgroundSoft"
                borderColor="$borderNeutralSoft"
                borderRadius="$r2"
                borderWidth={1}
                alignItems="center"
                gap="$s2"
                paddingHorizontal="$s3"
                overflow="hidden"
                focusStyle={{ borderColor: "$borderBrandStrong" }}
                focusVisibleStyle={{
                  outlineWidth: 0,
                  borderColor: "$borderBrandStrong",
                  outlineColor: "$borderBrandStrong",
                }}
              >
                <Text subHeadline color="$uiNeutralPlaceholder">
                  $
                </Text>
                <Input
                  borderWidth={0}
                  inputMode="decimal"
                  maxLength={6}
                  numberOfLines={1}
                  onChangeText={setInput}
                  fontSize={20}
                  padding={0}
                  textAlign="right"
                  value={input}
                  flex={1}
                />
              </XStack>
            </XStack>
          </View>
          <YStack paddingTop="$s6" paddingBottom="$s7" paddingHorizontal="$s4" gap="$s4_5">
            <YStack gap="$s3">
              {data?.installments.map(({ count, payments, rate, total }) => {
                const isBestRate = bestRateIndex === count - 1;
                return (
                  <XStack
                    key={count}
                    backgroundColor="$backgroundSoft"
                    borderRadius="$r3"
                    paddingHorizontal="$s4"
                    paddingVertical="$s4_5"
                    alignItems="center"
                    gap="$s3_5"
                  >
                    <YStack flex={1} gap="$s3" justifyContent="center">
                      {payments ? (
                        <Text headline>
                          <Text headline color="$uiNeutralSecondary">
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
                      <XStack gap="$s3" alignItems="center">
                        <Text footnote color={isBestRate ? "$interactiveOnBaseSuccessSoft" : "$uiNeutralSecondary"}>
                          {t("{{apr}} APR", {
                            apr: (Number(rate) / 1e18).toLocaleString(language, {
                              style: "percent",
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }),
                          })}
                        </Text>
                        {isBestRate && (
                          <YStack
                            backgroundColor="$interactiveBaseSuccessDefault"
                            borderRadius={4}
                            paddingHorizontal="$s2"
                            paddingVertical="$s1"
                          >
                            <Text caption2 emphasized color="$interactiveOnBaseSuccessDefault">
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
            {data && (
              <Text caption color="$uiNeutralSecondary">
                {t("First due date: {{date}} - then every 28 days.", {
                  date: new Date(data.firstMaturity * 1000).toLocaleDateString(language, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  }),
                })}
              </Text>
            )}
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}
