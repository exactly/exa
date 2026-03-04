import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons";
import { ScrollView, YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";

import BridgeDisclaimer from "./BridgeDisclaimer";
import MantecaDisclaimer from "./MantecaDisclaimer";
import FaceId from "../../assets/images/face-id.svg";
import completeOnboarding from "../../utils/completeOnboarding";
import { isValidCurrency } from "../../utils/currencies";
import { startAddressKYC, startMantecaKYC } from "../../utils/persona";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function KYC() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currency, network, provider, kycCode, acceptedTermsId } = useLocalSearchParams();
  const validCurrency = isValidCurrency(currency);
  const isCrypto = !!network;
  const isBridge = provider === "bridge";
  const isAddress = kycCode === "invalid address";
  const storedTokens = queryClient.getQueryData<{ inquiryId: string; sessionToken: string }>([
    "ramp",
    "kyc-tokens",
    provider,
  ]);

  const { mutateAsync: handleContinue, isPending } = useMutation({
    mutationKey: ["kyc", "complete", provider],
    async mutationFn() {
      if (typeof currency !== "string") return;

      function fail() {
        queryClient.removeQueries({ queryKey: ["ramp", "kyc-tokens", provider] });
        router.replace({
          pathname: "/add-funds/status",
          params: { status: "error", currency, provider, network },
        });
      }

      if (isAddress && !storedTokens) {
        fail();
        return;
      }
      const result = isAddress ? await startAddressKYC(storedTokens) : await startMantecaKYC(storedTokens);
      if (result.status === "cancel") return;
      if (result.status !== "complete") {
        fail();
        return;
      }
      queryClient.removeQueries({ queryKey: ["ramp", "kyc-tokens", provider] });
      await completeOnboarding(
        router,
        currency,
        isBridge ? "bridge" : "manteca",
        typeof acceptedTermsId === "string" ? acceptedTermsId : undefined,
        typeof network === "string" ? network : undefined,
      );
    },
  });

  if (!validCurrency && !isCrypto) return <Redirect href="/add-funds" />;

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
                queryClient.removeQueries({ queryKey: ["ramp", "kyc-tokens", provider] });
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
                    {storedTokens
                      ? isAddress
                        ? t("Your address needs to be verified")
                        : t("Your ID needs to be updated")
                      : t("We need more information about you")}
                  </Text>
                  <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                    {storedTokens
                      ? isAddress
                        ? t("There was an issue with your address. Please update your information to continue.")
                        : t("There was an issue with your tax ID. Please update your information to continue.")
                      : t("You’ll be able to add funds soon.")}
                  </Text>
                </YStack>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
        {isBridge ? <BridgeDisclaimer /> : <MantecaDisclaimer />}
        <Button onPress={handlePress} primary disabled={isPending} loading={isPending}>
          <Button.Text>
            {isPending ? t("Starting...") : storedTokens ? t("Update information") : t("Continue verification")}
          </Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
      </View>
    </SafeView>
  );
}
