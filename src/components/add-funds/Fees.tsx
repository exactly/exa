import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Check } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import BridgeDisclaimer from "./BridgeDisclaimer";
import MantecaDisclaimer from "./MantecaDisclaimer";
import RampWebView from "./RampWebView";
import { bridgeMethods, isValidCurrency, fees as rampFees, type Currency } from "../../utils/currencies";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import useRampOnboarding from "../../utils/useRampOnboarding";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Fees({ direction }: { direction: "offramp" | "onramp" }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const {
    currency: currencyParameter,
    network: networkParameter,
    provider: providerParameter,
  } = useLocalSearchParams();
  const currency = typeof currencyParameter === "string" ? currencyParameter : "";
  const network = typeof networkParameter === "string" ? networkParameter : "";
  const provider = typeof providerParameter === "string" ? providerParameter : "";
  const validCurrency = isValidCurrency(currency);
  const isCrypto = !!network;
  const isBridge = provider === "bridge";
  const offramp = direction === "offramp";
  const [acknowledged, setAcknowledged] = useState(true);
  const feeRows = rows(provider, currency, network, t);

  const { handleContinue, handleTOSRedirect, isPending, providerTOSLink, redirectURL, setTOSLink, tosLink } =
    useRampOnboarding(direction);

  const [locale = "en"] = language.split("-");
  const termsURL = isBridge
    ? `https://help.exactly.app/${locale}/articles/13862897-bridge-terms-and-conditions`
    : `https://help.exactly.app/${locale}/articles/13616694-fiat-on-ramp-terms-and-conditions`;

  const validProvider = provider === "bridge" || (!offramp && provider === "manteca");
  const validSelection = offramp ? validCurrency && !isCrypto : validCurrency || (!!currency && isCrypto);
  if (!validProvider || !validSelection) {
    return <Redirect href={offramp ? "/send-funds" : "/add-funds"} />;
  }

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
                {offramp
                  ? t(
                      "Bridge provides a United States virtual account, converts your USDC to {{currency}}, and sends the funds to bank accounts.",
                      { currency },
                    )
                  : isBridge
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
