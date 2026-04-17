import React, { useCallback, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Check } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import { useMutation, useQuery } from "@tanstack/react-query";

import domain from "@exactly/common/domain";

import BridgeDisclaimer from "./BridgeDisclaimer";
import MantecaDisclaimer from "./MantecaDisclaimer";
import RampWebView from "./RampWebView";
import completeOnboarding from "../../utils/completeOnboarding";
import { bridgeMethods, isValidCurrency, fees as rampFees, type Currency } from "../../utils/currencies";
import openBrowser from "../../utils/openBrowser";
import { APIError } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getKYCStatus, getRampProviders } from "../../utils/server";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Fees() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const { currency, network, provider } = useLocalSearchParams();
  const validCurrency = isValidCurrency(currency);
  const isCrypto = !!network;
  const isBridge = provider === "bridge";
  const [acknowledged, setAcknowledged] = useState(true);
  const [tosLink, setTOSLink] = useState<string>();
  const feeRows = rows(provider, currency, network, t);

  const { data: countryCode } = useQuery<string>({ queryKey: ["user", "country"] });
  const redirectURL = `https://${domain}/add-funds`;

  const { data: providers } = useQuery({
    queryKey: ["ramp", "providers", countryCode, redirectURL],
    queryFn: () => getRampProviders(countryCode, redirectURL),
    enabled: isBridge && !!countryCode,
    staleTime: 60_000,
  });
  const bridge = providers?.bridge;
  const providerTOSLink = bridge && "tosLink" in bridge ? bridge.tosLink : undefined;

  const { mutateAsync: handleBridgeOnboarding, isPending: isBridgePending } = useMutation({
    mutationKey: ["ramp", "onboarding", "bridge"],
    mutationFn: async (signedAgreementId: string) => {
      if (typeof currency !== "string") return;
      return await completeOnboarding(
        router,
        currency,
        "bridge",
        signedAgreementId,
        typeof network === "string" ? network : undefined,
      );
    },
  });

  const { mutateAsync: handleMantecaOnboarding, isPending: isMantecaPending } = useMutation({
    mutationKey: ["ramp", "onboarding", "manteca"],
    async mutationFn() {
      if (typeof currency !== "string") return;
      const status = await getKYCStatus("manteca").catch((error: unknown) => {
        if (error instanceof APIError) return { code: error.text };
        throw error;
      });
      const kycCode = "code" in status && typeof status.code === "string" ? status.code : "not started";

      if (kycCode === "not started") {
        router.replace({ pathname: "/add-funds/kyc", params: { currency, provider } });
        return;
      }

      if (kycCode === "ok") {
        await completeOnboarding(router, currency, "manteca");
        return;
      }

      router.replace({ pathname: "/add-funds/status", params: { status: "error", currency, provider } });
    },
  });

  const isPending = isBridgePending || isMantecaPending;
  const [locale = "en"] = language.split("-");
  const termsURL = isBridge
    ? `https://help.exactly.app/${locale}/articles/13862897-bridge-terms-and-conditions`
    : `https://help.exactly.app/${locale}/articles/13616694-fiat-on-ramp-terms-and-conditions`;

  const handleTOSRedirect = useCallback(
    (url: string) => {
      let signedAgreementId: string | undefined;
      try {
        signedAgreementId = new URL(url).searchParams.get("signed_agreement_id") ?? undefined;
      } catch {} // eslint-disable-line no-empty
      if (!signedAgreementId) {
        toast.show(t("Something went wrong. Please try again."), {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "error" },
        });
        return;
      }
      handleBridgeOnboarding(signedAgreementId).catch(reportError);
    },
    [handleBridgeOnboarding, t, toast],
  );

  const handleContinue = useCallback(async () => {
    if (isBridge) {
      if (!providerTOSLink) return;
      setTOSLink(providerTOSLink);
      return;
    }
    await handleMantecaOnboarding();
  }, [handleMantecaOnboarding, isBridge, providerTOSLink]);

  if (!validCurrency && !isCrypto) return <Redirect href="/add-funds" />;

  if (tosLink) {
    return (
      <SafeView fullScreen>
        <View padded alignSelf="flex-start">
          <IconButton icon={ArrowLeft} aria-label={t("Back")} onPress={() => setTOSLink(undefined)} />
        </View>
        <RampWebView
          uri={tosLink}
          redirectURL={redirectURL}
          onRedirect={(url) => {
            setTOSLink(undefined);
            handleTOSRedirect(url);
          }}
          onError={() => {
            setTOSLink(undefined);
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
        <View gap="$s4_5">
          <View flexDirection="row" gap="$s3_5" justifyContent="space-between" alignItems="center">
            <IconButton
              icon={ArrowLeft}
              aria-label={t("Back")}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(main)/(home)");
                }
              }}
            />
          </View>
        </View>
        <ScrollView flex={1}>
          <YStack flex={1} gap="$s5" padding="$s4">
            <YStack gap="$s5">
              <Text title3 emphasized>
                {t("Open your {{provider}} virtual account", { provider: isBridge ? "Bridge" : "Manteca" })}
              </Text>
              <Text color="$uiNeutralSecondary" subHeadline>
                {isBridge
                  ? t(
                      "Bridge provides a United States virtual account, converts your {{currency}} to USDC, and sends the funds to Exa App.",
                      { currency },
                    )
                  : t(
                      "Manteca provides local virtual account for {{currency}}, converts your transfers to USDC, and sends the funds to Exa App.",
                      { currency },
                    )}
              </Text>
            </YStack>
            <YStack gap="$s4_5">
              {feeRows.map(({ label, value, caption }) => (
                <FeeRow key={label} label={label} value={value} caption={caption} />
              ))}
            </YStack>
          </YStack>
        </ScrollView>

        <YStack gap="$s4_5">
          {isBridge ? <BridgeDisclaimer /> : <MantecaDisclaimer />}
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
                          openBrowser(termsURL).catch(reportError);
                        }}
                      />
                    ),
                  }}
                />
              </Text>
            </XStack>
          </XStack>
          <Button
            onPress={() => {
              handleContinue().catch(reportError);
            }}
            primary
            disabled={isPending || !acknowledged || (isBridge && !providerTOSLink)}
            loading={isPending}
          >
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

function FeeRow({ label, value, caption }: { caption?: string; label: string; value?: string }) {
  const { t } = useTranslation();
  return (
    <YStack>
      <XStack justifyContent="space-between" alignItems="center" gap="$s4">
        <Text headline>{label}</Text>
        <Text emphasized headline color="$uiSuccessSecondary">
          {t("Free")}
        </Text>
      </XStack>
      {caption || value ? (
        <XStack justifyContent="space-between" alignItems="center" gap="$s4">
          <Text footnote color="$uiNeutralSecondary" flex={1}>
            {caption}
          </Text>
          <Text emphasized footnote strikeThrough color="$uiNeutralSecondary" textAlign="right">
            {value}
          </Text>
        </XStack>
      ) : null}
    </YStack>
  );
}

function rows(
  provider?: string | string[],
  currency?: string | string[],
  network?: string | string[],
  t?: ReturnType<typeof useTranslation>["t"],
) {
  if (!t) return [];
  if (network) {
    return [
      { label: t("Account creation"), value: undefined, caption: undefined },
      { label: t("Account Maintenance"), value: undefined, caption: undefined },
    ];
  }
  if (!currency || !isValidCurrency(currency)) return [];
  if (provider === "manteca") {
    return [
      { label: t("Account creation"), value: undefined, caption: undefined },
      { label: t("Account Maintenance"), value: undefined, caption: undefined },
      { label: t("Transfer fee"), value: rampFees.manteca.transfer.fee, caption: undefined },
    ];
  }
  if (provider !== "bridge") return [];
  const method = bridgeMethod(currency);
  if (!method) return [];
  const fee = rampFees.bridge[method];
  return [
    { label: t("Account creation"), value: fee.creation, caption: undefined },
    { label: t("Account Maintenance"), value: fee.maintenance, caption: t("Monthly, while the account is in use") },
    ...(currency === "USD"
      ? [
          { label: t("{{method}} fee", { method: "ACH" }), value: rampFees.bridge.ACH.fee, caption: undefined },
          { label: t("{{method}} fee", { method: "WIRE" }), value: rampFees.bridge.WIRE.fee, caption: undefined },
        ]
      : [{ label: t("{{method}} fee", { method }), value: fee.fee, caption: undefined }]),
  ];
}

function bridgeMethod(currency: Currency) {
  if (currency === "USD") return "ACH" as const;
  const method = bridgeMethods[currency];
  if (!method || !(method in rampFees.bridge)) return;
  return method as keyof typeof rampFees.bridge;
}
