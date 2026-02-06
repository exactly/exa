import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Check } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";

import MantecaDisclaimer from "./MantecaDisclaimer";
import ARS from "../../assets/images/ars-usdc.svg";
import BRL from "../../assets/images/brl-usdc.svg";
import USD from "../../assets/images/usd-usdc.svg";
import completeOnboarding from "../../utils/completeOnboarding";
import { isValidCurrency } from "../../utils/currencies";
import openBrowser from "../../utils/openBrowser";
import { APIError } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getKYCStatus } from "../../utils/server";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

const currencyImages: Record<string, React.FC<{ height: string; width: string }>> = { ARS, BRL, USD };

export default function Onboard() {
  const { t } = useTranslation();
  const router = useRouter();

  const { currency } = useLocalSearchParams<{ currency: string }>();
  const validCurrency = isValidCurrency(currency);

  const [acknowledged, setAcknowledged] = useState(true);

  const { mutateAsync: handleOnboarding, isPending } = useMutation({
    mutationKey: ["ramp", "onboarding", "manteca"],
    async mutationFn() {
      if (!currency) return;
      const status = await getKYCStatus("manteca").catch((error: unknown) => {
        if (error instanceof APIError) return { code: error.text };
        throw error;
      });
      const kycCode = "code" in status && typeof status.code === "string" ? status.code : "not started";

      if (kycCode === "not started") {
        router.push({ pathname: "/add-funds/kyc", params: { currency } });
        return;
      }

      if (kycCode === "ok") {
        await completeOnboarding(router, currency);
        return;
      }

      router.replace({ pathname: "/add-funds/status", params: { status: "error", currency } });
    },
  });

  if (!validCurrency) return <Redirect href="/add-funds" />;

  const CurrencyImage = currencyImages[currency] ?? ARS;

  function handleContinue() {
    handleOnboarding().catch(reportError);
  }

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <View gap="$s4_5">
          <View flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
            <Pressable
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
          </View>
        </View>
        <ScrollView flex={1}>
          <View flex={1} gap="$s4_5">
            <YStack flex={1} padding="$s4" gap="$s6">
              <YStack flex={1} justifyContent="center">
                <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
                  <CurrencyImage width="100%" height="100%" />
                </View>
                <YStack gap="$s4" alignSelf="center">
                  <Text title emphasized textAlign="center" color="$interactiveTextBrandDefault">
                    {t("Turn {{currency}} transfers to onchain USDC", { currency })}
                  </Text>
                  <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                    {t("Transfer from accounts in your name and automatically receive USDC in your Exa account.")}
                  </Text>
                </YStack>
              </YStack>
            </YStack>
          </View>
        </ScrollView>

        <YStack gap="$s4_5">
          <MantecaDisclaimer />
          <XStack alignItems="center" gap="$s4" justifyContent="flex-start">
            <XStack
              cursor="pointer"
              onPress={() => {
                setAcknowledged(!acknowledged);
              }}
            >
              <View
                width={16}
                height={16}
                backgroundColor={acknowledged ? "$backgroundBrand" : "transparent"}
                borderColor="$backgroundBrand"
                borderWidth={1}
                borderRadius="$r2"
                justifyContent="center"
                alignItems="center"
              >
                {acknowledged && <Check size="$iconSize.xs" color="white" />}
              </View>
            </XStack>
            <XStack alignItems="center" cursor="pointer">
              <Text caption secondary>
                <Trans
                  i18nKey="I accept the <terms>Terms and Conditions</terms>."
                  components={{
                    terms: (
                      <Text
                        color="$interactiveTextBrandDefault"
                        cursor="pointer"
                        onPress={() => {
                          openBrowser(
                            "https://help.exactly.app/en/articles/13616694-fiat-on-ramp-terms-and-conditions",
                          ).catch(reportError);
                        }}
                      />
                    ),
                  }}
                />
              </Text>
            </XStack>
          </XStack>
          <Button onPress={handleContinue} primary disabled={isPending || !acknowledged} loading={isPending}>
            <Button.Text>{isPending ? t("Starting...") : t("Accept and continue")}</Button.Text>
            <Button.Icon>
              <ArrowRight />
            </Button.Icon>
          </Button>
        </YStack>
      </View>
    </SafeView>
  );
}
