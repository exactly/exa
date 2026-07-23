import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, CircleHelp } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { arbitrum, base, bsc, mainnet, optimism, polygon } from "viem/chains";

import chain from "@exactly/common/generated/chain";

import AddFundsOption from "./AddFundsOption";
import alchemyChainById from "../../utils/alchemyChains";
import { presentArticle } from "../../utils/intercom";
import { lifiChainsOptions, lifiTokensOptions } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import ChainLogo from "../shared/ChainLogo";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Network() {
  const router = useRouter();
  const { t } = useTranslation();
  const { asset: assetParameter } = useLocalSearchParams();
  const asset = typeof assetParameter === "string" ? assetParameter : "";
  const { data: lifiChains } = useQuery(lifiChainsOptions);
  const { data: tokens } = useQuery(lifiTokensOptions);
  const sorted = useMemo(() => {
    const available = new Set<number>(
      (tokens ?? []).filter((token) => token.symbol === asset).map((token) => token.chainId),
    );
    const others = (lifiChains ?? []).filter(
      (c) =>
        c.id !== chain.id &&
        c.mainnet &&
        available.has(c.id) &&
        alchemyChainById.has(c.id) &&
        !alchemyChainById.get(c.id)?.testnet,
    );
    const pinned: number[] = [mainnet.id, base.id, arbitrum.id, polygon.id, bsc.id].filter((id) => id !== chain.id);
    return [
      ...pinned.flatMap((id) => others.find((c) => c.id === id) ?? []),
      ...others.filter((c) => !pinned.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name)),
    ];
  }, [tokens, lifiChains, asset]);
  if (!asset) return <Redirect href="/add-funds/assets" />;
  function selectNetwork(chainId: number) {
    router.push({
      pathname: "/add-funds/add-crypto",
      params: chainId === chain.id ? { asset } : { asset, chainId: String(chainId) },
    });
  }
  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s6" fullScreen padded>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/add-funds/assets");
              }
            }}
          />
          <Text emphasized subHeadline primary>
            {t("Select network")}
          </Text>
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("8950801").catch(reportError);
            }}
          />
        </XStack>
        <ScrollView flex={1} showsVerticalScrollIndicator={false}>
          <YStack gap="$s7">
            <YStack gap="$s4">
              <Text emphasized primary headline>
                {t("Native network")}
              </Text>
              <AddFundsOption
                icon={<ChainLogo chainId={chain.id} size={24} />}
                title={chain.id === optimism.id ? "Optimism" : chain.name}
                subtitle={chain.id === optimism.id ? optimism.name : undefined}
                badge={t("Recommended")}
                onPress={() => selectNetwork(chain.id)}
              />
            </YStack>
            {sorted.length > 0 && (
              <YStack gap="$s4">
                <Text emphasized primary headline>
                  {t("Other networks")}
                </Text>
                <YStack gap="$s3_5">
                  {sorted.map((c) => (
                    <AddFundsOption
                      key={c.id}
                      icon={<ChainLogo chainId={c.id} size={24} />}
                      title={c.name}
                      onPress={() => selectNetwork(c.id)}
                    />
                  ))}
                </YStack>
              </YStack>
            )}
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}
