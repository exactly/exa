import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ChevronRight } from "@tamagui/lucide-icons";
import { View, XStack, YStack } from "tamagui";

import Text from "../shared/Text";

import type { ProviderInfo } from "../../utils/server";

type AddFiatButtonProperties = {
  currency: string;
  data?: ProviderInfo;
  provider: string;
};

const currencyMap: Record<string, { currencyName: string; emoji: string }> = {
  ARS: { currencyName: "Argentinian Pesos", emoji: "🇦🇷" },
  USD: { currencyName: "US Dollars", emoji: "🇺🇸" },
  BRL: { currencyName: "Brazilian Real", emoji: "🇧🇷" },
  EUR: { currencyName: "Euros", emoji: "🇪🇺" },
  MXN: { currencyName: "Mexican Pesos", emoji: "🇲🇽" },
  CLP: { currencyName: "Chilean Pesos", emoji: "🇨🇱" },
  COP: { currencyName: "Colombian Pesos", emoji: "🇨🇴" },
  CRC: { currencyName: "Costa Rican Colón", emoji: "🇨🇷" },
  GTQ: { currencyName: "Guatemalan Quetzal", emoji: "🇬🇹" },
  PHP: { currencyName: "Philippine Peso", emoji: "🇵🇭" },
  BOB: { currencyName: "Bolivian Boliviano", emoji: "🇧🇴" },
  PUSD: { currencyName: "Panamanian Balboa", emoji: "🇵🇦" },
};

export default function AddFiatButton({ provider, currency, data }: AddFiatButtonProperties) {
  const { t } = useTranslation();
  const router = useRouter();

  const { emoji } = currencyMap[currency] ?? { emoji: "💰", name: currency };

  if (data?.status === "NOT_AVAILABLE") {
    return null;
  }

  function handlePress() {
    if (data) {
      switch (data.status) {
        case "NOT_STARTED":
          router.push({
            pathname: "/add-funds/ramp-onboarding",
            params: { provider, currency },
          });
          break;

        case "ONBOARDING":
          router.push({
            pathname: "/add-funds/verification-status",
            params: { provider, status: "ONBOARDING", currency },
          });
          break;

        case "ACTIVE":
          router.push({
            pathname: "/add-funds/ramp-details",
            params: { provider, currency },
          });
          break;
      }
    }
  }

  return (
    <YStack
      padding="$s4_5"
      backgroundColor="$backgroundSoft"
      borderRadius="$r5"
      cursor="pointer"
      elevation={1}
      onPress={handlePress}
    >
      <XStack alignItems="center" gap="$s3_5" justifyContent="space-between">
        <XStack gap="$s3_5" alignItems="center" flex={1}>
          <View
            width={40}
            height={40}
            backgroundColor="$interactiveBaseBrandSoftDefault"
            borderRadius="$r3"
            padding="$s3"
            alignItems="center"
            justifyContent="center"
          >
            <Text>{emoji}</Text>
          </View>
          <YStack flex={1}>
            <Text emphasized headline primary>
              {currency}
            </Text>
            <Text footnote secondary>
              {t("From accounts in your name")}
            </Text>
          </YStack>
        </XStack>
        <View>
          <ChevronRight size={24} color="$uiBrandSecondary" />
        </View>
      </XStack>
    </YStack>
  );
}
