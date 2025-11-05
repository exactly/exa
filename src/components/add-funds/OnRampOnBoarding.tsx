import { ArrowLeft, Info, ArrowRight } from "@tamagui/lucide-icons";
import { useMutation } from "@tanstack/react-query";
import { openURL } from "expo-linking";
import { useLocalSearchParams, useNavigation } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform, Pressable } from "react-native";
import { ScrollView, Spinner, YStack } from "tamagui";

import LinkSheet from "./LinkSheet";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import FaceId from "../../assets/images/face-id.svg";
import { KYC_TEMPLATE_ID } from "../../utils/persona";
import reportError from "../../utils/reportError";
import { type APIError, startOnrampOnboarding, type OnRampProvider } from "../../utils/server";
import useOnRampProviders from "../../utils/useOnRampProviders";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function OnRampOnBoarding() {
  const navigation = useNavigation<AppNavigationProperties>();
  const [linkOpen, setLinkOpen] = useState(false);

  const parameters = useLocalSearchParams<{
    provider: OnRampProvider;
    currency: string;
    currencyName: string;
    signed_agreement_id?: string;
  }>();

  const { data: providers, refetch: refetchProviders } = useOnRampProviders();

  const providerData = providers?.providers[parameters.provider];
  const providerStatus = providerData?.status;
  const url = providerData?.pendingTasks?.[0]?.link ?? "";

  const { mutateAsync: completeBridgeOnboarding, isPending: bridgePending } = useMutation({
    mutationKey: ["onramp", "complete-onboarding", "bridge"],
    mutationFn: async (signedAgreementId: string) => {
      await startOnrampOnboarding({ provider: "bridge", acceptedTermsId: signedAgreementId }, KYC_TEMPLATE_ID);
    },
    onSuccess: async () => {
      const { data: updatedProviders } = await refetchProviders();
      if (!updatedProviders) return;
      const newStatus = updatedProviders.providers.bridge.status;
      handleNavigationAfterOnboarding(newStatus);
    },
    onError: (error: APIError) => {
      reportError(error);
    },
  });

  const { mutateAsync: completeMantecaOnboarding, isPending: mantecaPending } = useMutation({
    mutationKey: ["onramp", "complete-onboarding", "manteca"],
    mutationFn: async () => {
      await startOnrampOnboarding({ provider: "manteca" }, KYC_TEMPLATE_ID);
    },
    onSuccess: async () => {
      const { data: updatedProviders } = await refetchProviders();
      if (!updatedProviders) return;
      const newStatus = updatedProviders.providers.manteca.status;
      handleNavigationAfterOnboarding(newStatus);
    },
    onError: (error: APIError) => {
      reportError(error);
    },
  });

  function handleNavigationAfterOnboarding(newStatus: string) {
    if (newStatus === "ACTIVE") {
      if (parameters.currency) {
        navigation.replace("add-funds", {
          screen: "ramp-details",
          params: { provider: parameters.provider, currency: parameters.currency },
        });
      } else {
        navigation.replace("add-funds", { screen: "index" });
      }
    } else if (newStatus === "ONBOARDING") {
      navigation.replace("add-funds", {
        screen: "verification-status",
        params: { provider: parameters.provider, status: "ONBOARDING" },
      });
    } else {
      navigation.replace("add-funds", { screen: "index" });
    }
  }

  function handleContinue() {
    if (providerStatus === "NOT_STARTED") {
      if (parameters.provider === "bridge") {
        if (Platform.OS === "web") {
          if (parameters.signed_agreement_id) {
            completeBridgeOnboarding(parameters.signed_agreement_id).catch(reportError);
            return;
          }
          const providerUrl = new URL(url);
          const currentRedirectUri = providerUrl.searchParams.get("redirect_uri");
          if (currentRedirectUri) {
            const redirectUrl = new URL(currentRedirectUri);
            redirectUrl.searchParams.set("currency", parameters.currency);
            redirectUrl.searchParams.set("currencyName", parameters.currencyName);
            providerUrl.searchParams.set("redirect_uri", redirectUrl.toString());
          }
          openURL(providerUrl.toString()).catch(reportError);
          return;
        }
        setLinkOpen(true);
      } else {
        completeMantecaOnboarding().catch(reportError);
      }
    }
  }

  async function handleOnboardingSuccess(signedAgreementId?: string) {
    setLinkOpen(false);
    if (!signedAgreementId) return;
    await completeBridgeOnboarding(signedAgreementId).catch(reportError);
  }

  useEffect(() => {
    if (Platform.OS === "web" && parameters.signed_agreement_id) {
      const signedAgreementId = parameters.signed_agreement_id;
      const processOnboarding = async () => {
        await completeBridgeOnboarding(signedAgreementId);
      };

      processOnboarding().catch(reportError);
    }
  }, [completeBridgeOnboarding, parameters.signed_agreement_id]);

  const isOnboarding = parameters.provider === "bridge" ? bridgePending : mantecaPending;

  useEffect(() => {
    if (
      Platform.OS === "web" &&
      parameters.provider === "manteca" &&
      (providerStatus === "ONBOARDING" || providerStatus === "MISSING_INFORMATION") &&
      !parameters.currency &&
      !parameters.currencyName
    ) {
      navigation.replace("add-funds", {
        screen: "verification-status",
        params: { provider: "manteca", status: providerStatus },
      });
    }
  }, [parameters.provider, parameters.currency, parameters.currencyName, navigation, providerStatus]);

  return (
    <SafeView fullScreen>
      <View gap={20} fullScreen padded>
        <View gap={20}>
          <View flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
            <Pressable
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.navigate("add-funds", { screen: "index" });
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
            <YStack flex={1} padding="$s2" gap="$s6">
              <YStack flex={1} justifyContent="center">
                <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
                  <FaceId width="100%" height="100%" />
                </View>
                <Text title emphasized textAlign="center" color="$interactiveTextBrandDefault">
                  Turn {parameters.currencyName} transfers to onchain USDC
                </Text>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
        <Button onPress={handleContinue} primary disabled={isOnboarding}>
          <Button.Text>{isOnboarding ? "Please wait..." : "Accept and continue"}</Button.Text>
          <Button.Icon>
            {isOnboarding ? (
              <Spinner color="$interactiveOnBaseBrandDefault" width={24} height={24} />
            ) : (
              <ArrowRight color="$interactiveOnBaseBrandDefault" />
            )}
          </Button.Icon>
        </Button>
      </View>
      <LinkSheet
        open={linkOpen}
        onClose={() => {
          setLinkOpen(false);
        }}
        provider={parameters.provider}
        uri={url}
        onSuccess={handleOnboardingSuccess}
      />
    </SafeView>
  );
}
