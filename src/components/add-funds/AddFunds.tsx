import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, CircleHelp, Info, Wallet } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { isAddress } from "viem";

import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";

import AddFiatButton from "./AddFiatButton";
import AddFundsOption from "./AddFundsOption";
import OptimismImage from "../../assets/images/optimism.svg";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import { getKYCStatus, getRampProviders } from "../../utils/server";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { AuthMethod } from "../../utils/queryClient";
import type { Credential } from "@exactly/common/validation";

export default function AddFunds() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const ownerAccount = credential && isAddress(credential.credentialId) ? credential.credentialId : undefined;

  const { data: method } = useQuery<AuthMethod>({ queryKey: ["method"] });
  const { data: countryCode } = useQuery<string>({ queryKey: ["user", "country"] });

  const { data: kycStatus, isPending: isKYCPending } = useQuery({
    queryKey: ["kyc", "manteca"],
    queryFn: () => getKYCStatus("manteca"),
    retry: false,
  });

  const { data: providers, isPending: isProvidersPending } = useQuery({
    queryKey: ["ramp", "providers", countryCode],
    queryFn: () => getRampProviders("AR"),
    staleTime: 0,
  });

  const isPending = isKYCPending || (kycStatus && "code" in kycStatus && kycStatus.code === "ok" && isProvidersPending);

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap={20} fullScreen padded>
        <YStack gap={20}>
          <XStack flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
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
            <Text emphasized subHeadline primary>
              {t("Add Funds")}
            </Text>
            <Pressable
              onPress={() => {
                presentArticle("8950805").catch(reportError);
              }}
            >
              <CircleHelp color="$uiNeutralPrimary" />
            </Pressable>
          </XStack>
        </YStack>
        <ScrollView flex={1}>
          <YStack flex={1} gap="$s3_5">
            {method === "siwe" && (
              <AddFundsOption
                icon={<Wallet width={40} height={40} color="$iconBrandDefault" />}
                title={t("From connected wallet")}
                subtitle={
                  // TODO add support for ens resolution
                  ownerAccount ? shortenHex(ownerAccount, 4, 6) : ""
                }
                onPress={() => {
                  router.push("/add-funds/bridge");
                }}
              />
            )}
            <AddFundsOption
              icon={<OptimismImage width={40} height={40} />}
              title={t("From another wallet")}
              subtitle={t("On {{chain}}", { chain: chain.name })}
              onPress={() => {
                router.push("/add-funds/add-crypto");
              }}
            />
            <View flex={1} gap={20}>
              {isPending ? (
                <View justifyContent="center" alignItems="center">
                  <Skeleton width="100%" height={82} />
                </View>
              ) : (
                providers && (
                  <YStack gap={16}>
                    {Object.entries(providers.providers).flatMap(([providerKey, providerData]) => {
                      const currencies = providerData.onramp.currencies;
                      return currencies.map((currency) => (
                        <AddFiatButton
                          key={`${providerKey}-${currency}`}
                          provider={providerKey}
                          currency={currency}
                          data={providerData}
                        />
                      ));
                    })}
                  </YStack>
                )
              )}
            </View>
          </YStack>
        </ScrollView>
        <XStack
          gap="$s4"
          alignItems="flex-start"
          borderTopWidth={1}
          borderTopColor="$borderNeutralSoft"
          paddingTop="$s3"
        >
          <View>
            <Info size={16} width={16} height={16} color="$uiInfoSecondary" />
          </View>
          <XStack flex={1}>
            <Text emphasized caption2 color="$uiNeutralPlaceholder">
              {t("Assets are added to your balance as collateral to increase your credit limit.")}
              <Text
                cursor="pointer"
                emphasized
                caption2
                color="$uiBrandSecondary"
                onPress={() => {
                  presentArticle("8950805").catch(reportError);
                }}
              >
                &nbsp;{t("Learn more about collateral.")}
              </Text>
            </Text>
          </XStack>
        </XStack>
      </View>
    </SafeView>
  );
}
