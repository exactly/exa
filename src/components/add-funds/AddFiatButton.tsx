import { useNavigation } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { View, XStack } from "tamagui";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import type { ProviderInfo } from "../../utils/server";
import Text from "../shared/Text";

interface AddFiatButtonProperties {
  provider: string;
  currency: string;
  data: ProviderInfo;
}

export default function AddFiatButton({ provider, currency, data }: AddFiatButtonProperties) {
  const navigation = useNavigation<AppNavigationProperties>();

  const getCurrencyDisplay = () => {
    const currencyMap: Record<string, { emoji: string; currencyName: string }> = {
      ARS: { emoji: "🇦🇷", currencyName: "Argentinian Pesos" },
      USD: { emoji: "🇺🇸", currencyName: "US Dollars" },
      BRL: { emoji: "🇧🇷", currencyName: "Brazilian Real" },
      EUR: { emoji: "🇪🇺", currencyName: "Euros" },
      MXN: { emoji: "🇲🇽", currencyName: "Mexican Pesos" },
      CLP: { emoji: "🇨🇱", currencyName: "Chilean Pesos" },
      COP: { emoji: "🇨🇴", currencyName: "Colombian Pesos" },
      CRC: { emoji: "🇨🇷", currencyName: "Costa Rican Colón" },
      GTQ: { emoji: "🇬🇹", currencyName: "Guatemalan Quetzal" },
      PHP: { emoji: "🇵🇭", currencyName: "Philippine Peso" },
      BOB: { emoji: "🇧🇴", currencyName: "Bolivian Boliviano" },
      PUSD: { emoji: "🇵🇦", currencyName: "Panamanian Balboa" },
    };

    return currencyMap[currency] ?? { emoji: "💰", currencyName: currency };
  };

  const { emoji, currencyName } = getCurrencyDisplay();

  function handlePress() {
    switch (data.status) {
      case "NOT_AVAILABLE":
        navigation.navigate("add-funds", {
          screen: "index",
          params: { provider },
        });
        break;

      case "MISSING_INFORMATION":
        navigation.navigate("add-funds", {
          screen: "verification-status",
          params: { provider, currency, status: "MISSING_INFORMATION" },
        });
        break;
      case "NOT_STARTED":
        navigation.navigate("add-funds", {
          screen: "onramp-onboarding",
          params: { provider, currency, currencyName },
        });
        break;

      case "ONBOARDING":
        navigation.navigate("add-funds", {
          screen: "verification-status",
          params: { provider, currency },
        });
        break;

      case "ACTIVE":
        navigation.navigate("add-funds", {
          screen: "ramp-details",
          params: { provider, currency },
        });
        break;
    }
  }

  return (
    <Pressable onPress={handlePress}>
      <View borderWidth={1} borderRadius="$r5" borderColor="$borderNeutralSoft" padding={16} gap={20}>
        <View gap={10} flexDirection="row" alignItems="center">
          <View
            width={50}
            height={50}
            borderRadius="$r3"
            backgroundColor="$interactiveBaseBrandSoftDefault"
            justifyContent="center"
            alignItems="center"
          >
            <Text fontSize={24}>{emoji}</Text>
          </View>
          <View gap={5} flex={1}>
            <View flexDirection="row" alignItems="center" gap={8}>
              <Text fontSize={17} fontWeight="bold">
                {currency}
              </Text>
              {data.status === "ONBOARDING" && (
                <View backgroundColor="$backgroundWarning" paddingHorizontal={8} paddingVertical={4} borderRadius="$r2">
                  <Text fontSize={11} fontWeight="bold" color="$textWarning">
                    Pending...
                  </Text>
                </View>
              )}
              {data.status === "MISSING_INFORMATION" && (
                <View backgroundColor="$backgroundInfo" paddingHorizontal={8} paddingVertical={4} borderRadius="$r2">
                  <Text fontSize={11} fontWeight="bold" color="$textInfo">
                    Action needed
                  </Text>
                </View>
              )}
            </View>
            <XStack gap={2}>
              <Text fontSize={13} color="$uiNeutralSecondary" textTransform="capitalize">
                {provider} •
              </Text>
              <Text fontSize={13} color="$uiNeutralSecondary">
                {provider === "manteca" ? "From accounts in your name" : "From any account"}
              </Text>
            </XStack>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
