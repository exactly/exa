import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { X } from "@tamagui/lucide-icons";
import { ScrollView, Spinner, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import domain from "@exactly/common/domain";

import BridgeDisclaimer from "./BridgeDisclaimer";
import MantecaDisclaimer from "./MantecaDisclaimer";
import Denied from "../../assets/images/denied.svg";
import FaceId from "../../assets/images/face-id.svg";
import { isValidCurrency } from "../../utils/currencies";
import { getRampProviders } from "../../utils/server";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Status() {
  const { t } = useTranslation();
  const router = useRouter();

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
    enabled: isPending && timedOut && !!countryCode,
  });

  useEffect(() => {
    if (isPending && providers?.[typedProvider].status === "ACTIVE" && currency) {
      if (isCrypto) {
        router.replace({
          pathname: "/add-funds/add-crypto",
          params: { provider: typedProvider, currency, network },
        });
      } else {
        router.replace({ pathname: "/add-funds/ramp", params: { currency, provider: typedProvider } });
      }
    }
  }, [isPending, providers, currency, isCrypto, network, router, typedProvider]);

  const ready = !isPending || (timedOut && !isFetching);

  if (!validCurrency && !isCrypto) return <Redirect href="/add-funds" />;

  function handleClose() {
    router.replace("/(main)/(home)");
  }

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <ScrollView flex={1}>
          <View flex={1} gap="$s4_5">
            <YStack flex={1} padding="$s4" gap="$s6">
              <YStack flex={1} justifyContent="center">
                <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
                  {isOnboarding ? <FaceId width="100%" height="100%" /> : <Denied width="100%" height="100%" />}
                </View>
                <YStack gap="$s4" alignSelf="center">
                  <Text title emphasized textAlign="center" color="$interactiveTextBrandDefault">
                    {isOnboarding ? t("Almost there!") : t("Verification failed")}
                  </Text>
                  <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                    {isOnboarding
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
          <Button onPress={handleClose} primary>
            <Button.Text>{t("Close")}</Button.Text>
            <Button.Icon>
              <X size={24} />
            </Button.Icon>
          </Button>
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
