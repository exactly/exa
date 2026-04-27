import React from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons";
import { ScrollView, YStack } from "tamagui";

import ARS from "../../assets/images/ars.svg";
import Background from "../../assets/images/background.svg";
import Base from "../../assets/images/base.svg";
import BRL from "../../assets/images/brl.svg";
import EUR from "../../assets/images/euro.svg";
import MXN from "../../assets/images/mxn.svg";
import GBP from "../../assets/images/pounds.svg";
import Solana from "../../assets/images/solana.svg";
import Stellar from "../../assets/images/stellar.svg";
import Tron from "../../assets/images/tron.svg";
import USD from "../../assets/images/usd.svg";
import USDC from "../../assets/images/usdc.svg";
import USDT from "../../assets/images/usdt.svg";
import { isValidCurrency } from "../../utils/currencies";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

type SvgComponent = React.FC<{ height: string; viewBox?: string; width: string }>;
type Layer = { Svg: SvgComponent; viewBox?: string };

const fiat: Record<string, SvgComponent> = { ARS, BRL, EUR, GBP, MXN, USD };
const networks: Record<string, SvgComponent> = { BASE: Base, SOLANA: Solana, STELLAR: Stellar, TRON: Tron };
const crypto: Record<string, SvgComponent> = { USDC, USDT };

const NATIVE = "0 0 390 390";
const FRONT = "-40 -36 390 390";

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
          <View flex={1} gap="$s4_5">
            <YStack flex={1} padding="$s4" gap="$s6">
              <YStack flex={1} justifyContent="center">
                <View width="100%" aspectRatio={1}>
                  {(
                    [
                      { Svg: Background },
                      typeof currency === "string"
                        ? isCrypto
                          ? crypto[currency] && { Svg: crypto[currency] }
                          : fiat[currency] && { Svg: fiat[currency], viewBox: NATIVE }
                        : undefined,
                      isCrypto && typeof network === "string"
                        ? networks[network] && { Svg: networks[network], viewBox: NATIVE }
                        : typeof currency === "string" && fiat[currency]
                          ? { Svg: USDC, viewBox: FRONT }
                          : undefined,
                    ] as (Layer | undefined)[]
                  )
                    .filter((v): v is Layer => !!v)
                    .map(({ Svg, viewBox }, index) => (
                      // eslint-disable-next-line @eslint-react/no-array-index-key -- stateless svg layers, never reordered
                      <View key={index} position="absolute" width="100%" height="100%">
                        <Svg width="100%" height="100%" {...(viewBox && { viewBox })} />
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
