import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, Banknote, Blocks, CircleHelp, Info, Wallet } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { isAddress } from "viem";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";

import AddFundsOption from "./AddFundsOption";
import AddRampButton from "./AddRampButton";
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
  const { type } = useLocalSearchParams();
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

  const redirectURL = `https://${domain}/add-funds`;
  const { data: providers, isPending } = useQuery({
    queryKey: ["ramp", "providers", countryCode, redirectURL],
    queryFn: () => getRampProviders(countryCode, redirectURL),
    enabled: !!countryCode,
    staleTime: 0,
  });

  const hasFiat =
    providers && Object.values(providers).some((p) => p.onramp.currencies.some((item) => typeof item === "string"));

  function renderProviders(filter: "crypto" | "fiat") {
    if (countryCode && isPending) {
      return (
        <View justifyContent="center" alignItems="center">
          <Skeleton width="100%" height={82} />
        </View>
      );
    }
    if (!providers) return null;
    return (
      <YStack gap="$s4">
        {Object.entries(providers).flatMap(([providerKey, provider]) =>
          provider.onramp.currencies
            .filter((item) => (filter === "crypto") === (typeof item === "object"))
            .map((item) => {
              const isCrypto = typeof item === "object";
              const currency = isCrypto ? item.currency : item;
              const network = isCrypto ? item.network : undefined;
              return (
                <AddRampButton
                  key={`${providerKey}-${currency}-${network ?? "fiat"}`}
                  currency={currency}
                  network={network}
                  provider={providerKey as "bridge" | "manteca"}
                  status={provider.status}
                />
              );
            }),
        )}
      </YStack>
    );
  }

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s6" fullScreen padded>
        <YStack gap="$s4_5">
          <XStack flexDirection="row" gap="$s3_5" justifyContent="space-between" alignItems="center">
            <Pressable
              onPress={() => {
                if (type === "crypto" || type === "fiat") {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace("/add-funds");
                  }
                } else {
                  router.replace("/(main)/(home)");
                }
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
            <Text emphasized subHeadline primary>
              {t(type === "crypto" ? "Cryptocurrencies" : type === "fiat" ? "Bank transfers" : "Add Funds")}
            </Text>
            <Pressable
              onPress={() => {
                presentArticle("8950801").catch(reportError);
              }}
            >
              <CircleHelp color="$uiNeutralPrimary" />
            </Pressable>
          </XStack>
        </YStack>
        <ScrollView flex={1}>
          <YStack flex={1} gap="$s3_5">
            {type !== "crypto" && type !== "fiat" && (
              <>
                <AddFundsOption
                  icon={<Blocks size={24} color="$iconBrandDefault" />}
                  title={t("Cryptocurrencies")}
                  subtitle={t("Multiple networks and wallets")}
                  onPress={() => {
                    router.push({ pathname: "/add-funds", params: { type: "crypto" } });
                  }}
                />
                {hasFiat !== false && (
                  <AddFundsOption
                    icon={<Banknote size={24} color="$iconBrandDefault" />}
                    title={t("Bank transfers")}
                    subtitle={t("From a bank account")}
                    disabled={!hasFiat}
                    onPress={() => {
                      router.push({ pathname: "/add-funds", params: { type: "fiat" } });
                    }}
                  />
                )}
              </>
            )}
            {type === "crypto" && (
              <>
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

                {renderProviders("crypto")}
              </>
            )}
            {type === "fiat" && providers && (
              <YStack gap="$s5">
                {(["manteca", "bridge"] as const).map((key) => {
                  const provider = providers[key];
                  if (provider.status === "NOT_AVAILABLE") return null;
                  const fiatCurrencies = provider.onramp.currencies.filter((item) => typeof item === "string");
                  if (fiatCurrencies.length === 0) return null;
                  return (
                    <YStack key={key} gap="$s3_5">
                      <Text footnote color="$uiNeutralSecondary">
                        {key === "manteca"
                          ? countryCode === "AR"
                            ? t("From any Argentine bank account in your name")
                            : t("From any account in your name")
                          : t("From any account")}
                      </Text>
                      <YStack gap="$s3_5">
                        {fiatCurrencies.map((item) => {
                          if (typeof item !== "string") return null;
                          return <AddRampButton key={item} currency={item} provider={key} status={provider.status} />;
                        })}
                      </YStack>
                    </YStack>
                  );
                })}
              </YStack>
            )}
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
