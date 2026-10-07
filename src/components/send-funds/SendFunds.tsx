import React from "react";
import { useTranslation } from "react-i18next";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, Banknote, Blocks, CircleHelp } from "@tamagui/lucide-icons-2";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { base } from "viem/chains";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";

import { presentArticle } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getKYCStatus, getRampProviders } from "../../utils/server";
import useKYC from "../../utils/useKYC";
import AddFundsOption from "../add-funds/AddFundsOption";
import RampButton from "../ramp/RampButton";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function SendFunds() {
  const { type } = useLocalSearchParams();
  const router = useRouter();
  const { t } = useTranslation();

  const { approved: isKYCApproved } = useKYC();

  const { data: countryCode } = useQuery({
    queryKey: ["user", "country"],
    queryFn: async () => {
      await getKYCStatus("basic", true);
      return queryClient.getQueryData<string>(["user", "country"]) ?? "";
    },
    staleTime: (query) => (query.state.data ? Infinity : 0),
    retry: false,
  });

  const redirectURL = `https://${domain}/send-funds`;
  const { data: providers, isPending } = useQuery({
    queryKey: ["ramp", "providers", countryCode, redirectURL],
    queryFn: () => getRampProviders(countryCode, redirectURL),
    enabled: !!countryCode,
    staleTime: 0,
  });

  const hasFiat =
    providers &&
    Object.values(providers).some(
      (provider) => "offramp" in provider && provider.offramp.currencies.some((item) => typeof item === "string"),
    );

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
      <YStack gap="$s3_5">
        {Object.entries(providers).flatMap(([providerKey, provider]) => {
          if (!("offramp" in provider)) return [];
          return provider.offramp.currencies
            .filter((item) => (filter === "crypto") === (typeof item === "object"))
            .map((item) => {
              const isCrypto = typeof item === "object";
              const currency = isCrypto ? item.currency : item;
              const network = isCrypto ? item.network : undefined;
              return (
                <RampButton
                  key={`${providerKey}-${currency}-${network ?? "fiat"}`}
                  currency={currency}
                  direction="offramp"
                  network={network}
                  provider={providerKey as "bridge" | "manteca"}
                  status={provider.status}
                />
              );
            });
        })}
      </YStack>
    );
  }

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s6" fullScreen padded>
        <YStack gap="$s4_5">
          <XStack flexDirection="row" gap="$s3_5" justifyContent="space-between" alignItems="center">
            <IconButton
              icon={ArrowLeft}
              aria-label={t("Back")}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace(type === "fiat" ? "/send-funds" : "/(main)/(home)");
              }}
            />
            <Text emphasized subHeadline primary>
              {t(type === "fiat" ? "Bank transfers" : "Send")}
            </Text>
            <IconButton
              icon={CircleHelp}
              aria-label={t("Help")}
              onPress={() => {
                presentArticle(type === "fiat" ? "8950801" : "9056481").catch(reportError);
              }}
            />
          </XStack>
        </YStack>
        <ScrollView flex={1}>
          <YStack flex={1} gap="$s3_5">
            {type !== "fiat" && (
              <>
                <AddFundsOption
                  icon={<Blocks size={24} color="$iconBrandDefault" />}
                  title={t("Digital assets")}
                  subtitle={t("USDC, ETH, stocks, and more")}
                  onPress={() => {
                    router.push("/send-funds/receiver");
                  }}
                />
                {hasFiat !== false && chain.id !== base.id && (
                  <AddFundsOption
                    icon={<Banknote size={24} color="$iconBrandDefault" />}
                    title={t("Bank transfers")}
                    subtitle={t("Pesos, dollars, or euros")}
                    disabled={isKYCApproved && !hasFiat}
                    onPress={() => {
                      router.push(
                        isKYCApproved ? { pathname: "/send-funds", params: { type: "fiat" } } : "/send-funds/welcome",
                      );
                    }}
                  />
                )}
              </>
            )}
            {type === "fiat" && renderProviders("fiat")}
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}
