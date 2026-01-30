import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons";
import { ScrollView, Spinner, YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";

import ARS from "../../assets/images/ars-usdc.svg";
import BRL from "../../assets/images/brl-usdc.svg";
import USD from "../../assets/images/usd-usdc.svg";
import { isValidCurrency } from "../../utils/currencies";
import queryClient, { APIError } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getKYCStatus, getRampProviders, startRampOnboarding } from "../../utils/server";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

const currencyImages: Record<string, React.FC<{ height: string; width: string }>> = { ARS, BRL, USD };

export default function Onboard() {
  const { t } = useTranslation();
  const router = useRouter();

  const { currency } = useLocalSearchParams<{ currency: string }>();
  const countryCode = queryClient.getQueryData<string>(["user", "country"]) ?? "";
  const validCurrency = isValidCurrency(currency);

  const { mutateAsync: handleOnboarding, isPending } = useMutation({
    mutationKey: ["ramp", "onboarding", "manteca"],
    mutationFn: async () => {
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
        await completeOnboarding();
        return;
      }

      router.replace({
        pathname: "/add-funds/status",
        params: { status: "error", currency },
      });
    },
  });

  const CurrencyImage = currency ? (currencyImages[currency] ?? ARS) : ARS;

  if (!validCurrency) return <Redirect href="/add-funds" />;

  async function completeOnboarding() {
    try {
      await startRampOnboarding({ provider: "manteca" });

      await queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] });

      const providers = await queryClient.fetchQuery({
        queryKey: ["ramp", "providers", countryCode],
        queryFn: () => getRampProviders(countryCode),
        staleTime: 0,
      });

      const newStatus = providers.providers.manteca.status;

      if (newStatus === "ACTIVE") {
        router.replace({ pathname: "/add-funds/ramp", params: { currency } });
      } else if (newStatus === "ONBOARDING") {
        router.replace({ pathname: "/add-funds/status", params: { status: newStatus, currency } });
      } else {
        router.replace({ pathname: "/add-funds/status", params: { status: "error", currency } });
      }
    } catch (error) {
      reportError(error);
      router.replace({
        pathname: "/add-funds/status",
        params: { status: "error", currency },
      });
    }
  }

  function handleContinue() {
    handleOnboarding().catch(reportError);
  }

  return (
    <SafeView fullScreen>
      <View gap={20} fullScreen padded>
        <View gap={20}>
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
          <View flex={1} gap={20}>
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
        <Button onPress={handleContinue} primary disabled={isPending}>
          <Button.Text>{isPending ? t("Starting...") : t("Accept and continue")}</Button.Text>
          <Button.Icon>{isPending ? <Spinner height={24} width={24} /> : <ArrowRight />}</Button.Icon>
        </Button>
      </View>
    </SafeView>
  );
}
