import React from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons";
import { ScrollView, YStack } from "tamagui";

import AssetHero from "./AssetHero";
import { bridgeMethods, isValidCurrency } from "../../utils/currencies";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function RampOnboard({ direction }: { direction: "offramp" | "onramp" }) {
  const { t } = useTranslation();
  const router = useRouter();
  const offramp = direction === "offramp";

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
  const validProvider = provider === "bridge" || (!offramp && provider === "manteca");
  const validSelection = offramp ? validCurrency && !isCrypto : validCurrency || (!!currency && isCrypto);

  if (!validProvider || !validSelection) {
    return <Redirect href={offramp ? "/send-funds" : "/add-funds"} />;
  }

  const method = currency in bridgeMethods ? bridgeMethods[currency as keyof typeof bridgeMethods] : undefined;

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <View gap="$s4_5">
          <View flexDirection="row" gap="$s3_5" justifyContent="space-between" alignItems="center">
            <IconButton
              icon={ArrowLeft}
              aria-label={t("Back")}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace(offramp ? "/send-funds" : "/(main)/(home)");
              }}
            />
          </View>
        </View>
        <ScrollView flex={1}>
          <View flex={1} gap="$s4_5">
            <YStack flex={1} padding="$s4" gap="$s6">
              <YStack flex={1} justifyContent="center">
                <AssetHero direction={direction} currency={currency || undefined} network={network || undefined} />
                <YStack gap="$s4" alignSelf="center">
                  <Text title emphasized textAlign="center" color="$interactiveTextBrandDefault">
                    {offramp
                      ? isCrypto
                        ? t("Send {{crypto}} to {{network}}", { crypto: currency, network })
                        : t("Send {{currency}} using your USDC", { currency })
                      : isCrypto
                        ? t("Deposit {{crypto}} via {{network}}", { crypto: currency, network })
                        : t("Turn {{currency}} transfers to onchain USDC", { currency })}
                  </Text>
                  <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                    {offramp
                      ? isCrypto
                        ? t("Send USDC from your Exa account and receive {{crypto}} on {{network}}.", {
                            crypto: currency,
                            network,
                          })
                        : method
                          ? t(
                              "Transfer USDC to a bank account via {{method}}. Add the beneficiary's bank details to start.",
                              { method },
                            )
                          : t("Transfer USDC to a bank account. Add the beneficiary's bank details to start.")
                      : isCrypto
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
              router.push({
                pathname: offramp ? "/send-funds/fees" : "/add-funds/fees",
                params: { currency, provider, ...(network && { network }) },
              });
            }}
            primary
          >
            <Button.Text>{t("Continue")}</Button.Text>
            <Button.Icon>
              <ArrowRight />
            </Button.Icon>
          </Button>
          {offramp && (
            <Text
              cursor="pointer"
              emphasized
              footnote
              color="$interactiveBaseBrandDefault"
              textAlign="center"
              onPress={() => {
                presentArticle("8950801").catch(reportError);
              }}
            >
              {t("Learn more about transfer times")}
            </Text>
          )}
        </YStack>
      </View>
    </SafeView>
  );
}
