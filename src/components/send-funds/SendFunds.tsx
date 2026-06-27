import React from "react";
import { useTranslation } from "react-i18next";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, Banknote, Blocks, CircleHelp } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { base } from "viem/chains";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";

import { presentArticle } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getKYCStatus, getRampProviders } from "../../utils/server";
import useBeginKYC from "../../utils/useBeginKYC";
import AddFundsOption from "../add-funds/AddFundsOption";
import RampButton from "../ramp/RampButton";
import ChainLogo from "../shared/ChainLogo";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { KYCStatus } from "../../utils/server";

export default function SendFunds() {
  const { type } = useLocalSearchParams();
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToastController();

  const { data: kycStatus } = useQuery<KYCStatus>({ queryKey: ["kyc", "status"] });
  const beginKYC = useBeginKYC();
  const isKYCApproved =
    !!kycStatus && "code" in kycStatus && (kycStatus.code === "ok" || kycStatus.code === "legacy kyc");

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
                if (type === "crypto" || type === "fiat") {
                  if (router.canGoBack()) router.back();
                  else router.replace("/send-funds");
                } else {
                  router.replace("/(main)/(home)");
                }
              }}
            />
            <Text emphasized subHeadline primary>
              {t(type === "crypto" ? "Cryptocurrencies" : type === "fiat" ? "Bank transfers" : "Send")}
            </Text>
            <IconButton
              icon={CircleHelp}
              aria-label={t("Help")}
              onPress={() => {
                presentArticle("8950801").catch(reportError);
              }}
            />
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
                    router.push({ pathname: "/send-funds", params: { type: "crypto" } });
                  }}
                />
                {hasFiat !== false && chain.id !== base.id && (
                  <AddFundsOption
                    icon={<Banknote size={24} color="$iconBrandDefault" />}
                    title={t("Bank transfers")}
                    subtitle={t("To a bank account")}
                    disabled={(isKYCApproved && !hasFiat) || beginKYC.isPending}
                    loading={beginKYC.isPending}
                    onPress={() => {
                      if (isKYCApproved) {
                        router.push({ pathname: "/send-funds", params: { type: "fiat" } });
                        return;
                      }
                      beginKYC.mutate(undefined, {
                        onSuccess(result) {
                          if (result.status === "cancel") return;
                          const approved =
                            "code" in result.kyc && (result.kyc.code === "ok" || result.kyc.code === "legacy kyc");
                          if (approved) {
                            queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] }).catch(reportError);
                            router.push({ pathname: "/send-funds", params: { type: "fiat" } });
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
                  />
                )}
              </>
            )}
            {type === "crypto" && (
              <AddFundsOption
                icon={<ChainLogo size={24} borderRadius="$r3" />}
                title={t("On chain")}
                subtitle={t("Send to any wallet on {{chain}}", { chain: chain.name })}
                onPress={() => {
                  router.push("/send-funds/receiver");
                }}
              />
            )}
            {type === "fiat" && renderProviders("fiat")}
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}
