import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Headset, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Spinner, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import domain from "@exactly/common/domain";

import BridgeDisclaimer from "./BridgeDisclaimer";
import MantecaDisclaimer from "./MantecaDisclaimer";
import RampWebView from "./RampWebView";
import Denied from "../../assets/images/denied.svg";
import Documents from "../../assets/images/documents.svg";
import FaceId from "../../assets/images/face-id.svg";
import { isValidCurrency } from "../../utils/currencies";
import { newMessage } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getRampProviders } from "../../utils/server";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Status() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToastController();

  const { currency, network, status, pending, provider, direction } = useLocalSearchParams<{
    currency?: string;
    direction?: string;
    network?: string;
    pending?: string;
    provider?: string;
    status: string;
  }>();
  const validCurrency = isValidCurrency(currency);
  const isCrypto = !!network;
  const isOnboarding = status === "ONBOARDING";
  const isPending = pending === "true";
  const offramp = direction === "offramp";
  const typedProvider = offramp || provider === "bridge" ? "bridge" : "manteca";

  const [timedOut, setTimedOut] = useState(!isPending);
  const [openKYC, setOpenKYC] = useState(false);
  useEffect(() => {
    if (!isPending) return;
    const timeout = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(timeout);
  }, [isPending]);

  const { data: countryCode } = useQuery<string>({ queryKey: ["user", "country"] });
  const redirectURL = `https://${domain}/${offramp ? "send-funds" : "add-funds"}`;
  const { data: providers, isFetching } = useQuery({
    queryKey: ["ramp", "providers", countryCode, redirectURL],
    queryFn: () => getRampProviders(countryCode, redirectURL),
    enabled: (isPending ? timedOut : isOnboarding && typedProvider === "bridge") && !!countryCode,
  });
  const bridge = providers?.bridge;
  const kycLink = bridge && "kycLink" in bridge ? bridge.kycLink : undefined;
  const needsMoreInfo = isOnboarding && typedProvider === "bridge" && !!kycLink;
  const providerStatus = providers?.[typedProvider].status;
  const needsSupport = status === "CONTACT_SUPPORT" || providerStatus === "CONTACT_SUPPORT";
  const offrampAvailable =
    !!currency &&
    !!bridge &&
    "offramp" in bridge &&
    bridge.offramp.currencies.some((item) => (typeof item === "string" ? item : item.currency) === currency);

  useEffect(() => {
    if ((isOnboarding || isPending) && providerStatus === "ACTIVE" && currency) {
      if (offramp) {
        if (!offrampAvailable) return;
        router.replace({ pathname: "/send-funds/recipients", params: { currency, provider: typedProvider } });
      } else if (isCrypto) {
        router.replace({
          pathname: "/add-funds/add-crypto",
          params: { provider: typedProvider, currency, network },
        });
      } else {
        router.replace({ pathname: "/add-funds/ramp", params: { currency, provider: typedProvider } });
      }
    }
  }, [
    isOnboarding,
    isPending,
    currency,
    isCrypto,
    network,
    router,
    typedProvider,
    offramp,
    offrampAvailable,
    providerStatus,
  ]);

  const ready = !isPending || (timedOut && !isFetching);

  if (!validCurrency && !isCrypto) return <Redirect href={offramp ? "/send-funds" : "/add-funds"} />;

  function handleClose() {
    router.replace("/(main)/(home)");
  }

  if (openKYC && kycLink) {
    return (
      <SafeView fullScreen>
        <View padded alignSelf="flex-start">
          <IconButton icon={ArrowLeft} aria-label={t("Back")} onPress={() => setOpenKYC(false)} />
        </View>
        <RampWebView
          uri={kycLink}
          redirectURL={redirectURL}
          onRedirect={() => {
            setOpenKYC(false);
            queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] }).catch(reportError);
          }}
          onError={() => {
            setOpenKYC(false);
            toast.show(t("Something went wrong. Please try again."), {
              duration: 1000,
              burntOptions: { haptic: "error", preset: "error" },
            });
          }}
        />
      </SafeView>
    );
  }

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        {needsMoreInfo ? (
          <View alignItems="flex-start">
            <IconButton
              icon={ArrowLeft}
              aria-label={t("Back")}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace("/(main)/(home)");
              }}
            />
          </View>
        ) : null}
        <ScrollView flex={1}>
          <View flex={1} gap="$s4_5">
            <YStack flex={1} padding="$s4" gap="$s6">
              <YStack flex={1} justifyContent="center">
                <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
                  {needsMoreInfo ? (
                    <Documents width="100%" height="100%" />
                  ) : isOnboarding || needsSupport ? (
                    <FaceId width="100%" height="100%" />
                  ) : (
                    <Denied width="100%" height="100%" />
                  )}
                </View>
                <YStack gap="$s4" alignSelf="center">
                  <Text title emphasized textAlign="center" color="$interactiveTextBrandDefault">
                    {needsMoreInfo
                      ? t("Bridge needs more information")
                      : needsSupport
                        ? t("We couldn’t complete your verification")
                        : isOnboarding
                          ? t("Almost there!")
                          : t("Verification failed")}
                  </Text>
                  <Text
                    color={needsSupport ? "$uiNeutralSecondary" : "$uiNeutralPlaceholder"}
                    footnote
                    textAlign="center"
                  >
                    {needsMoreInfo
                      ? t("Bridge needs a few more details before creating your account.")
                      : needsSupport
                        ? t("Reach out to our support team and we’ll get you back on track.")
                        : isOnboarding
                          ? t("We’re verifying your information. You’ll be able to add funds soon.")
                          : t("There was an error verifying your information.")}
                  </Text>
                </YStack>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
        {!needsSupport && (typedProvider === "bridge" ? <BridgeDisclaimer /> : <MantecaDisclaimer />)}
        {ready ? (
          needsMoreInfo ? (
            <Button onPress={() => setOpenKYC(true)} primary>
              <Button.Text>{t("Complete verification")}</Button.Text>
              <Button.Icon>
                <ArrowRight size={24} />
              </Button.Icon>
            </Button>
          ) : needsSupport ? (
            <YStack gap="$s4" alignItems="center">
              <Button
                width="100%"
                onPress={() => {
                  newMessage(t("I need help completing my verification")).catch(reportError);
                }}
                primary
              >
                <Button.Text>{t("Contact support")}</Button.Text>
                <Button.Icon>
                  <Headset size={24} />
                </Button.Icon>
              </Button>
              <Pressable onPress={handleClose}>
                <Text emphasized footnote color="$interactiveTextBrandDefault">
                  {t("Close")}
                </Text>
              </Pressable>
            </YStack>
          ) : (
            <Button onPress={handleClose} primary>
              <Button.Text>{t("Close")}</Button.Text>
              <Button.Icon>
                <X size={24} />
              </Button.Icon>
            </Button>
          )
        ) : (
          <Button disabled primary>
            <Button.Text>{t("Verifying...")}</Button.Text>
            <Spinner color="$interactiveOnDisabled" />
          </Button>
        )}
      </View>
    </SafeView>
  );
}
