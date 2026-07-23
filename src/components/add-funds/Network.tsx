import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, CircleHelp } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQueries, useQuery } from "@tanstack/react-query";
import { arbitrum, base, bsc, mainnet, optimism, polygon } from "viem/chains";

import chain, { allowlists } from "@exactly/common/generated/chain";

import AddFundsOption from "./AddFundsOption";
import ReceiveGuideSheet from "./ReceiveGuideSheet";
import alchemyChainById from "../../utils/alchemyChains";
import factoryOptions from "../../utils/factoryOptions";
import { presentArticle } from "../../utils/intercom";
import { lifiChainsOptions, lifiTokensOptions, tokenCorrelation } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useMarkets from "../../utils/useMarkets";
import ChainLogo from "../shared/ChainLogo";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Credential } from "@exactly/common/validation";

export default function Network() {
  const router = useRouter();
  const { t } = useTranslation();
  const { asset: assetParameter } = useLocalSearchParams();
  const asset = typeof assetParameter === "string" ? assetParameter : "";
  const [pending, setPending] = useState<{
    chainId: number;
    symbol: string;
    variant: "bridge" | "bridgeSwap" | "swap";
  }>();
  const { data: lifiChains } = useQuery(lifiChainsOptions);
  const { data: tokens } = useQuery(lifiTokensOptions);
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: bridgeAcknowledged } = useQuery<boolean>({ queryKey: ["settings", "bridge-needed-shown"] });
  const { data: swapAcknowledged } = useQuery<boolean>({ queryKey: ["settings", "swap-needed-shown"] });
  const { data: bridgeSwapAcknowledged } = useQuery<boolean>({ queryKey: ["settings", "bridge-swap-needed-shown"] });
  const { supportedAssets, isPending } = useMarkets();
  const symbols = useMemo(() => {
    const matched = new Map<number, string>();
    for (const token of tokens ?? []) {
      const correlated =
        token.symbol in tokenCorrelation ? tokenCorrelation[token.symbol as keyof typeof tokenCorrelation] : undefined;
      if (token.symbol !== asset && correlated !== asset) continue;
      const allowed = allowlists[String(token.chainId)];
      if (!allowed?.some((address) => address.toLowerCase() === token.address.toLowerCase())) continue;
      if (token.symbol === asset || !matched.has(token.chainId)) matched.set(token.chainId, token.symbol);
    }
    return matched;
  }, [tokens, asset]);
  const sorted = useMemo(() => {
    const others = (lifiChains ?? []).filter(
      (c) =>
        c.id !== chain.id &&
        c.mainnet &&
        symbols.has(c.id) &&
        alchemyChainById.has(c.id) &&
        !alchemyChainById.get(c.id)?.testnet,
    );
    const pinned: number[] = [mainnet.id, base.id, arbitrum.id, polygon.id, bsc.id].filter((id) => id !== chain.id);
    return [
      ...pinned.flatMap((id) => others.find((c) => c.id === id) ?? []),
      ...others.filter((c) => !pinned.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name)),
    ];
  }, [lifiChains, symbols]);
  const deployable = useQueries({
    queries: sorted.map((c) => factoryOptions(credential?.factory, c.id)),
    combine: (results) => sorted.filter((c, index) => results[index]?.data),
  });
  if (!asset) return <Redirect href="/add-funds/assets" />;
  const receivable = isPending || !tokens || supportedAssets.includes(asset) || symbols.has(chain.id);
  function navigate(chainId: number, symbol: string) {
    router.push({
      pathname: "/add-funds/add-crypto",
      params: chainId === chain.id ? { asset, symbol } : { asset, chainId: String(chainId), symbol },
    });
  }
  function selectNetwork(chainId: number) {
    const supported = isPending || supportedAssets.includes(asset);
    const symbol = chainId === chain.id && supported ? asset : (symbols.get(chainId) ?? asset);
    const variant = chainId === chain.id ? (supported ? undefined : "swap") : supported ? "bridge" : "bridgeSwap";
    const acknowledged = { bridge: bridgeAcknowledged, bridgeSwap: bridgeSwapAcknowledged, swap: swapAcknowledged };
    if (variant && !acknowledged[variant]) {
      setPending({ chainId, symbol, variant });
      return;
    }
    navigate(chainId, symbol);
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
            {receivable && (
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
            )}
            {deployable.length > 0 && (
              <YStack gap="$s4">
                <Text emphasized primary headline>
                  {t("Other networks")}
                </Text>
                <YStack gap="$s3_5">
                  {deployable.map((c) => (
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
        <ReceiveGuideSheet
          open={pending !== undefined}
          variant={pending?.variant ?? "bridge"}
          asset={asset}
          symbol={pending?.symbol ?? asset}
          chainId={pending && pending.chainId !== chain.id ? pending.chainId : undefined}
          network={
            pending?.chainId === chain.id ? chain.name : (sorted.find((c) => c.id === pending?.chainId)?.name ?? "")
          }
          onClose={() => setPending(undefined)}
          onContinue={(hide) => {
            if (pending) {
              if (hide) queryClient.setQueryData(["settings", settingsKeys[pending.variant]], true);
              navigate(pending.chainId, pending.symbol);
            }
            setPending(undefined);
          }}
        />
      </View>
    </SafeView>
  );
}

const settingsKeys = {
  bridge: "bridge-needed-shown",
  bridgeSwap: "bridge-swap-needed-shown",
  swap: "swap-needed-shown",
};
