import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { X } from "@tamagui/lucide-icons";
import { ScrollView, Spinner, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

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

  const { currency, status, pending } = useLocalSearchParams<{ currency: string; pending: string; status: string }>();
  const validCurrency = isValidCurrency(currency);
  const isOnboarding = status === "ONBOARDING";
  const isPending = pending === "true";

  const [timedOut, setTimedOut] = useState(!isPending);
  useEffect(() => {
    if (!isPending) return;
    const timeout = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(timeout);
  }, [isPending]);

  const { data: countryCode } = useQuery<string>({ queryKey: ["user", "country"] });
  const { data: providers, isFetching } = useQuery({
    queryKey: ["ramp", "providers", countryCode],
    queryFn: () => getRampProviders(countryCode),
    enabled: isPending && timedOut && !!countryCode,
  });

  useEffect(() => {
    if (isPending && providers?.manteca.status === "ACTIVE" && currency) {
      router.replace({ pathname: "/add-funds/ramp", params: { currency } });
    }
  }, [isPending, providers, currency, router]);

  const ready = !isPending || (timedOut && !isFetching);

  if (!validCurrency) return <Redirect href="/add-funds" />;

  function handleClose() {
    router.replace("/(main)/(home)");
  }

  return (
    <SafeView fullScreen>
      <View gap={20} fullScreen padded>
        <ScrollView flex={1}>
          <View flex={1} gap={20}>
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
                      ? t("We're verifying your information. You'll be able to add funds soon.")
                      : t("There was an error verifying your information.")}
                  </Text>
                </YStack>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
        <MantecaDisclaimer />
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
