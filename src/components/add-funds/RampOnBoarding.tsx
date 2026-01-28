import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Info } from "@tamagui/lucide-icons";
import { ScrollView, Spinner, YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";

import ARSUSDC from "../../assets/images/ars-usdc.svg";
import { startMantecaKYC } from "../../utils/persona";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getKYCStatus, getRampProviders, startRampOnboarding, type RampProvider } from "../../utils/server";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function RampOnBoarding() {
  const { t } = useTranslation();
  const router = useRouter();

  const parameters = useLocalSearchParams<{
    currency: string;
    provider: RampProvider;
  }>();

  const { currency, provider } = parameters;

  const { mutateAsync: handleOnboarding, isPending } = useMutation({
    mutationKey: ["ramp", "onboarding", provider],
    mutationFn: async () => {
      const status = await getKYCStatus("manteca").catch(() => ({ code: "not started" as const }));
      const kycCode = "code" in status && typeof status.code === "string" ? status.code : "not started";

      if (kycCode === "not started") {
        const result = await startMantecaKYC();
        if (result.status === "cancel") {
          return;
        }
        if (result.status === "error") {
          router.replace({
            pathname: "/add-funds/verification-status",
            params: { status: "error", currency },
          });
          return;
        }
        await completeOnboarding();
        return;
      }

      if (kycCode === "ok") {
        await completeOnboarding();
        return;
      }

      router.replace({
        pathname: "/add-funds/verification-status",
        params: { provider, status: kycCode, currency },
      });
    },
  });

  async function completeOnboarding() {
    try {
      await startRampOnboarding({ provider: "manteca" });

      const providers = await queryClient.fetchQuery({
        queryKey: ["ramp", "providers"],
        queryFn: () => getRampProviders(),
        staleTime: 0,
      });

      const newStatus = providers.providers.manteca.status;

      if (newStatus === "ACTIVE") {
        router.replace({
          pathname: "/add-funds/ramp-details",
          params: { provider, currency },
        });
      } else {
        router.replace({
          pathname: "/add-funds/verification-status",
          params: { provider, status: newStatus, currency },
        });
      }
    } catch (error) {
      reportError(error);
      router.replace({
        pathname: "/add-funds/verification-status",
        params: { provider, status: "error", currency },
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
            <Pressable>
              <Info color="$uiNeutralPrimary" />
            </Pressable>
          </View>
        </View>
        <ScrollView flex={1}>
          <View flex={1} gap={20}>
            <YStack flex={1} padding="$s4" gap="$s6">
              <YStack flex={1} justifyContent="center">
                <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
                  <ARSUSDC width="100%" height="100%" />
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
