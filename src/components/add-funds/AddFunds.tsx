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
import { presentArticle } from "../../utils/intercom";
import queryClient, { type AuthMethod } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getKYCStatus, getRampProviders } from "../../utils/server";
import ChainLogo from "../shared/ChainLogo";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Credential } from "@exactly/common/validation";

export default function AddFunds() {
  const router = useRouter();
  const { t } = useTranslation();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const ownerAccount = credential && isAddress(credential.credentialId) ? credential.credentialId : undefined;

  const { data: method } = useQuery<AuthMethod>({ queryKey: ["method"] });

  const { data: countryCode } = useQuery({
    queryKey: ["user", "country"],
    queryFn: async () => {
      await getKYCStatus("basic", true);
      return queryClient.getQueryData<string>(["user", "country"]) ?? "";
    },
    staleTime: (query) => (query.state.data ? Infinity : 0),
    retry: false,
  });

  const { data: providers, isPending } = useQuery({
    queryKey: ["ramp", "providers", countryCode],
    queryFn: () => getRampProviders(countryCode),
    enabled: !!countryCode,
    staleTime: 0,
  });

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s4_5" fullScreen padded>
        <YStack gap="$s4_5">
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
              icon={<ChainLogo size={24} borderRadius="$r3" />}
              title={t("From another wallet")}
              subtitle={t("On {{chain}}", { chain: chain.name })}
              onPress={() => {
                router.push("/add-funds/add-crypto");
              }}
            />
            <View flex={1} gap="$s4_5">
              {countryCode && isPending ? (
                <View justifyContent="center" alignItems="center">
                  <Skeleton width="100%" height={82} />
                </View>
              ) : (
                providers && (
                  <YStack gap="$s3_5">
                    {Object.entries(providers).flatMap(([providerKey, provider]) => {
                      const currencies = provider.onramp.currencies;
                      return currencies.map((currency) => (
                        <AddFiatButton
                          key={`${providerKey}-${currency}`}
                          currency={currency}
                          status={provider.status}
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
