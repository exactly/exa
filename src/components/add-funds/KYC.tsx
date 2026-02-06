import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons";
import { ScrollView, YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";

import MantecaDisclaimer from "./MantecaDisclaimer";
import FaceId from "../../assets/images/face-id.svg";
import completeOnboarding from "../../utils/completeOnboarding";
import { isValidCurrency } from "../../utils/currencies";
import { startMantecaKYC } from "../../utils/persona";
import reportError from "../../utils/reportError";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function KYC() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currency } = useLocalSearchParams<{ currency: string }>();
  const validCurrency = isValidCurrency(currency);

  const { mutateAsync: handleContinue, isPending } = useMutation({
    mutationKey: ["kyc", "complete", "manteca"],
    async mutationFn() {
      if (!currency) return;
      const result = await startMantecaKYC();
      if (result.status === "cancel") return;
      if (result.status === "error") {
        router.replace({ pathname: "/add-funds/status", params: { status: "error", currency } });
        return;
      }
      await completeOnboarding(router, currency);
    },
  });

  if (!validCurrency) return <Redirect href="/add-funds" />;

  function handlePress() {
    handleContinue().catch(reportError);
  }

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <View gap="$s4_5">
          <View flexDirection="row" gap="$s3" justifyContent="space-between" alignItems="center">
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
                  <FaceId width="100%" height="100%" />
                </View>
                <YStack gap="$s4" alignSelf="center">
                  <Text title emphasized textAlign="center" color="$interactiveTextBrandDefault">
                    {t("We need more information about you")}
                  </Text>
                  <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                    {t("You’ll be able to add funds soon.")}
                  </Text>
                </YStack>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
        <MantecaDisclaimer />
        <Button onPress={handlePress} primary disabled={isPending} loading={isPending}>
          <Button.Text>{isPending ? t("Starting...") : t("Continue verification")}</Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
      </View>
    </SafeView>
  );
}
