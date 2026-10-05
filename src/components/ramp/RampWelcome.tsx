import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons-2";
import { useToastController } from "@tamagui/toast";
import { ScrollView, YStack } from "tamagui";

import ARS from "../../assets/images/ars.svg";
import BRL from "../../assets/images/brl.svg";
import EUR from "../../assets/images/euro.svg";
import MXN from "../../assets/images/mxn.svg";
import GBP from "../../assets/images/pounds.svg";
import USD from "../../assets/images/usd.svg";
import USDC from "../../assets/images/usdc.svg";
import background from "../../assets/images/welcome-background.svg";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useBeginKYC from "../../utils/useBeginKYC";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import ThemedSvg from "../shared/ThemedSvg";
import View from "../shared/View";

export default function RampWelcome({ direction }: { direction: "offramp" | "onramp" }) {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const beginKYC = useBeginKYC();
  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <View flexDirection="row" gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/(main)/(home)");
            }}
          />
        </View>
        <ScrollView flex={1}>
          <YStack flex={1} padding="$s4" gap="$s6" justifyContent="center">
            <View width="100%" aspectRatio={1}>
              <View position="absolute" width="100%" height="100%">
                <ThemedSvg xml={background} width="100%" height="100%" />
              </View>
              {coins.map(({ Svg, artwork, x, y, diameter }) => {
                const scale = artwork.diameter / diameter;
                const viewBox = `${artwork.x - x * scale} ${artwork.y - y * scale} ${390 * scale} ${390 * scale}`;
                return (
                  <View key={viewBox} position="absolute" width="100%" height="100%">
                    <Svg width="100%" height="100%" viewBox={viewBox} />
                  </View>
                );
              })}
            </View>
            <YStack gap="$s6">
              <Text title emphasized textAlign="center" color="$interactiveTextBrandDefault">
                {t(
                  direction === "offramp"
                    ? "Send money in dollars, euros, and more"
                    : "Receive money in dollars, euros, and more",
                )}
              </Text>
              <Text footnote textAlign="center" color="$uiNeutralSecondary">
                {t(
                  direction === "offramp"
                    ? "Send USDC from Exa App to bank accounts in supported currencies."
                    : "Share your account details to receive transfers in supported currencies from anywhere. Funds arrive as USDC in Exa App.",
                )}
              </Text>
            </YStack>
          </YStack>
        </ScrollView>
        <Button
          primary
          disabled={beginKYC.isPending}
          loading={beginKYC.isPending}
          onPress={() => {
            beginKYC.mutate(undefined, {
              onSuccess(result) {
                if (result.status === "cancel") return;
                if (result.status === "blocked") {
                  router.push("/(main)/getting-started");
                  return;
                }
                if ("code" in result.kyc && (result.kyc.code === "ok" || result.kyc.code === "legacy kyc")) {
                  queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] }).catch(reportError);
                  router.replace({
                    pathname: direction === "offramp" ? "/send-funds" : "/add-funds",
                    params: { type: "fiat" },
                  });
                } else {
                  router.replace("/(main)/(home)");
                }
              },
              onError(error) {
                toast.show(t("Error verifying identity"), {
                  duration: 1000,
                  burntOptions: { haptic: "error", preset: "error" },
                });
                reportError(error);
              },
            });
          }}
        >
          <Button.Text>{t("Continue")}</Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
      </View>
    </SafeView>
  );
}

const fiat = { x: 144, y: 148, diameter: 144 };
const crypto = { x: 195, y: 195, diameter: 168 };

const coins: {
  artwork: typeof fiat;
  diameter: number;
  Svg: React.FC<{ height: string; viewBox?: string; width: string }>;
  x: number;
  y: number;
}[] = [
  { Svg: USD, artwork: fiat, x: 105, y: 55, diameter: 64 },
  { Svg: GBP, artwork: fiat, x: 330, y: 219, diameter: 64 },
  { Svg: MXN, artwork: fiat, x: 294, y: 325, diameter: 64 },
  { Svg: BRL, artwork: fiat, x: 127, y: 310, diameter: 64 },
  { Svg: EUR, artwork: fiat, x: 59, y: 190, diameter: 64 },
  { Svg: USDC, artwork: crypto, x: 195, y: 184, diameter: 120 },
  { Svg: ARS, artwork: fiat, x: 271, y: 73, diameter: 64 },
];
