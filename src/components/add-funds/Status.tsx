import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, X } from "@tamagui/lucide-icons";
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

  const { currency, network, status, pending, provider } = useLocalSearchParams<{
    currency?: string;
    network?: string;
    pending?: string;
    provider?: string;
    status: string;
  }>();
  const validCurrency = isValidCurrency(currency);
  const isCrypto = !!network;
  const isOnboarding = status === "ONBOARDING";
  const isPending = pending === "true";
  const typedProvider = provider === "bridge" ? provider : "manteca";

  const [timedOut, setTimedOut] = useState(!isPending);
  const [openKYC, setOpenKYC] = useState(false);
  useEffect(() => {
    if (!isPending) return;
    const timeout = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(timeout);
  }, [isPending]);

  const { data: countryCode } = useQuery<string>({ queryKey: ["user", "country"] });
  const redirectURL = `https://${domain}/add-funds`;
  const { data: providers, isFetching } = useQuery({
    queryKey: ["ramp", "providers", countryCode, redirectURL],
    queryFn: () => getRampProviders(countryCode, redirectURL),
    enabled: (isPending ? timedOut : isOnboarding && typedProvider === "bridge") && !!countryCode,
  });
  const bridge = providers?.bridge;
  const kycLink = bridge && "kycLink" in bridge ? bridge.kycLink : undefined;
  const needsMoreInfo = isOnboarding && typedProvider === "bridge" && !!kycLink;

  useEffect(() => {
    if ((isOnboarding || isPending) && providers?.[typedProvider].status === "ACTIVE" && currency) {
      if (isCrypto) {
        router.replace({
          pathname: "/add-funds/add-crypto",
          params: { provider: typedProvider, currency, network },
        });
      } else {
        router.replace({ pathname: "/add-funds/ramp", params: { currency, provider: typedProvider } });
      }
    }
  }, [isOnboarding, isPending, providers, currency, isCrypto, network, router, typedProvider]);

  const ready = !isPending || (timedOut && !isFetching);

  if (!validCurrency && !isCrypto) return <Redirect href="/add-funds" />;

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
              native: true,
              duration: 1000,
              burntOptions: { haptic: "error" },
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
                  ) : isOnboarding ? (
                    <FaceId width="100%" height="100%" />
                  ) : (
                    <Denied width="100%" height="100%" />
                  )}
                </View>
                <YStack gap="$s4" alignSelf="center">
                  <Text title emphasized textAlign="center" color="$interactiveTextBrandDefault">
                    {needsMoreInfo
                      ? t("Bridge needs more information")
                      : isOnboarding
                        ? t("Almost there!")
                        : t("Verification failed")}
                  </Text>
                  <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                    {needsMoreInfo
                      ? t("Bridge needs a few more details before creating your account.")
                      : isOnboarding
                        ? t("We’re verifying your information. You’ll be able to add funds soon.")
                        : t("There was an error verifying your information.")}
                  </Text>
                </YStack>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
        {typedProvider === "bridge" ? <BridgeDisclaimer /> : <MantecaDisclaimer />}
        {ready ? (
          needsMoreInfo ? (
            <Button onPress={() => setOpenKYC(true)} primary>
              <Button.Text>{t("Complete verification")}</Button.Text>
              <Button.Icon>
                <ArrowRight size={24} />
              </Button.Icon>
            </Button>
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
