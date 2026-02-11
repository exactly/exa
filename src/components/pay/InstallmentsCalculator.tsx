import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, CircleHelp } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { formatUnits, parseUnits } from "viem";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import {
  fixedRate,
  fixedUtilization,
  globalUtilization,
  MATURITY_INTERVAL,
  splitInstallments,
  WAD,
} from "@exactly/lib";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useInstallmentRates from "../../utils/useInstallmentRates";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

const INSTALLMENTS = Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1);

export default function InstallmentsCalculator() {
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [input, setInput] = useState("100");
  const assets = useMemo(() => parseUnits(input.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), 6), [input]);
  const { market } = useAsset(marketUSDCAddress);
  const rates = useInstallmentRates();
  const installmentData = useMemo(() => {
    if (!market) return;
    const calculationAssets = assets > 0n ? assets : 100_000_000n;
    const timestamp = Math.floor(Date.now() / 1000);
    const nextMaturity = timestamp - (timestamp % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    const firstMaturity =
      nextMaturity - timestamp < MIN_BORROW_INTERVAL ? nextMaturity + MATURITY_INTERVAL : nextMaturity;
    const {
      fixedPools,
      floatingBackupBorrowed,
      floatingUtilization,
      interestRateModel: { parameters },
      totalFloatingBorrowAssets,
      totalFloatingDepositAssets,
    } = market;
    const uGlobal = globalUtilization(totalFloatingDepositAssets, totalFloatingBorrowAssets, floatingBackupBorrowed);
    const borrowImpact =
      totalFloatingDepositAssets > 0n ? (calculationAssets * WAD - 1n) / totalFloatingDepositAssets + 1n : 0n;
    try {
      const result = INSTALLMENTS.map((count) => {
        const uFixed = fixedPools
          .filter(({ maturity }) => maturity >= firstMaturity && maturity < firstMaturity + count * MATURITY_INTERVAL)
          .map(({ supplied, borrowed }) => fixedUtilization(supplied, borrowed, totalFloatingDepositAssets));
        if (uFixed.length === 0) return { count, installments: undefined, totalAmount: 0n };
        if (count === 1) {
          const rate = fixedRate(
            firstMaturity,
            fixedPools.length,
            (uFixed[0] ?? 0n) + borrowImpact,
            floatingUtilization,
            uGlobal + borrowImpact,
            parameters,
            timestamp,
          );
          const time = BigInt(firstMaturity - timestamp);
          const fee = (calculationAssets * rate * time) / (WAD * 31_536_000n);
          const total = calculationAssets + fee;
          return { count, installments: [total], totalAmount: total };
        }
        const { installments } = splitInstallments(
          calculationAssets,
          totalFloatingDepositAssets,
          firstMaturity,
          fixedPools.length,
          uFixed,
          floatingUtilization,
          uGlobal,
          parameters,
          timestamp,
        );
        return { count, installments, totalAmount: installments.reduce((a, b) => a + b, 0n) };
      });
      return { result, firstMaturity };
    } catch (error) {
      reportError(error);
    }
  }, [market, assets]);

  const bestAprIndex = useMemo(() => {
    if (!rates) return;
    let minIndex = 0;
    for (let index = 1; index < rates.length; index++) {
      if ((rates[index] ?? 0n) < (rates[minIndex] ?? 0n)) minIndex = index;
    }
    return minIndex;
  }, [rates]);

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
                if (router.canGoBack()) router.back();
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
                  {t("to estimate installments cost")}
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
              {INSTALLMENTS.map((count) => {
                const data = installmentData?.result[count - 1];
                const isBestAPR = bestAprIndex === count - 1;
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
                      {data?.installments ? (
                        <Text headline>
                          <Text headline color="$uiNeutralSecondary">
                            {count}x{" "}
                          </Text>
                          $
                          {Number(formatUnits(data.installments[0] ?? 0n, 6)).toLocaleString(language, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </Text>
                      ) : (
                        <Skeleton height={23} width={120} />
                      )}
                      <XStack gap="$s3" alignItems="center">
                        {rates?.[count - 1] === undefined ? (
                          <Skeleton height={18} width={80} />
                        ) : (
                          <>
                            <Text footnote color={isBestAPR ? "$interactiveOnBaseSuccessSoft" : "$uiNeutralSecondary"}>
                              {t("{{apr}} APR", {
                                apr: (Number(rates[count - 1]) / 1e18).toLocaleString(language, {
                                  style: "percent",
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }),
                              })}
                            </Text>
                            {isBestAPR && (
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
                          </>
                        )}
                      </XStack>
                    </YStack>
                    {data?.installments ? (
                      <Text title3>
                        $
                        {Number(formatUnits(data.totalAmount, 6)).toLocaleString(language, {
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
            {installmentData && (
              <Text caption color="$uiNeutralSecondary">
                {t("First due date: {{date}} - then every 28 days.", {
                  date: new Date(installmentData.firstMaturity * 1000).toLocaleDateString(language, {
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
