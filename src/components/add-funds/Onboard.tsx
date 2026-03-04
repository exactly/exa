import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons";
import { ScrollView, YStack } from "tamagui";

import ARSBack from "../../assets/images/ars-back.svg";
import Background from "../../assets/images/background.svg";
import BRLBack from "../../assets/images/brl-back.svg";
import EURBack from "../../assets/images/euro-back.svg";
import MXNBack from "../../assets/images/mxn-back.svg";
import GBPBack from "../../assets/images/pounds-back.svg";
import SolanaNetwork from "../../assets/images/solana-network.svg";
import StellarNetwork from "../../assets/images/stellar-network.svg";
import TronNetwork from "../../assets/images/tron-network.svg";
import USDBack from "../../assets/images/usd-back.svg";
import USDCCentered from "../../assets/images/usdc-centered.svg";
import USDCFront from "../../assets/images/usdc-front.svg";
import USDTCentered from "../../assets/images/usdt-centered.svg";
import { isValidCurrency } from "../../utils/currencies";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

type SvgComponent = React.FC<{ height: string; width: string }>;

const fiatLayers: Record<string, SvgComponent> = {
  ARS: ARSBack,
  BRL: BRLBack,
  EUR: EURBack,
  GBP: GBPBack,
  MXN: MXNBack,
  USD: USDBack,
};
const networkLayers: Record<string, SvgComponent> = {
  SOLANA: SolanaNetwork,
  STELLAR: StellarNetwork,
  TRON: TronNetwork,
};
const cryptoBase: Record<string, SvgComponent> = { USDC: USDCCentered, USDT: USDTCentered };

export default function Onboard() {
  const { t } = useTranslation();
  const router = useRouter();

  const { currency, network, provider } = useLocalSearchParams();
  const validCurrency = isValidCurrency(currency);
  const isCrypto = !!network;

  if (!validCurrency && !isCrypto) return <Redirect href="/add-funds" />;

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <View gap="$s4_5">
          <View flexDirection="row" gap="$s3_5" justifyContent="space-between" alignItems="center">
            <Pressable
              onPress={() => {
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
                <View width="100%" aspectRatio={1}>
                  {[
                    Background,
                    typeof currency === "string" ? (isCrypto ? cryptoBase[currency] : fiatLayers[currency]) : undefined,
                    isCrypto && typeof network === "string"
                      ? networkLayers[network]
                      : typeof currency === "string" && fiatLayers[currency]
                        ? USDCFront
                        : undefined,
                  ]
                    .filter((v): v is SvgComponent => !!v)
                    .map((Layer, index) => (
                      // eslint-disable-next-line @eslint-react/no-array-index-key -- stateless svg layers, never reordered
                      <View key={index} position="absolute" width="100%" height="100%">
                        <Layer width="100%" height="100%" />
                      </View>
                    ))}
                </View>
                <YStack gap="$s4" alignSelf="center">
                  <Text title emphasized textAlign="center" color="$interactiveTextBrandDefault">
                    {isCrypto
                      ? t("Deposit {{crypto}} via {{network}}", { crypto: currency, network })
                      : t("Turn {{currency}} transfers to onchain USDC", { currency })}
                  </Text>
                  <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                    {isCrypto
                      ? t("Send {{crypto}} on {{network}} and receive funds in your Exa account.", {
                          crypto: currency,
                          network,
                        })
                      : t("Transfer from accounts in your name and automatically receive USDC in your Exa account.")}
                  </Text>
                </YStack>
              </YStack>
            </YStack>
          </View>
        </ScrollView>

        <YStack gap="$s4_5">
          <Button
            onPress={() => {
              router.push({ pathname: "/add-funds/fees", params: { currency, provider, ...(network && { network }) } });
            }}
            primary
          >
            <Button.Text>{t("Continue")}</Button.Text>
            <Button.Icon>
              <ArrowRight />
            </Button.Icon>
          </Button>
        </YStack>
      </View>
    </SafeView>
  );
}
