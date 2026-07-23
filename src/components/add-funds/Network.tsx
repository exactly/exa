import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, CircleHelp, Search } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { arbitrum, base, bsc, mainnet, polygon } from "viem/chains";

import chain from "@exactly/common/generated/chain";

import AddFundsOption from "./AddFundsOption";
import ReceiveGuideSheet from "./ReceiveGuideSheet";
import alchemyChainById from "../../utils/alchemyChains";
import { presentArticle } from "../../utils/intercom";
import { lifiChainsOptions, lifiTokensOptions } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useMarkets from "../../utils/useMarkets";
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
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<{ chainId: number; variant: "bridge" | "bridgeSwap" | "swap" }>();
  const { data: lifiChains } = useQuery(lifiChainsOptions);
  const { data: tokens } = useQuery(lifiTokensOptions);
  const { data: bridgeAcknowledged } = useQuery<boolean>({ queryKey: ["settings", "bridge-needed-shown"] });
  const { data: swapAcknowledged } = useQuery<boolean>({ queryKey: ["settings", "swap-needed-shown"] });
  const { data: bridgeSwapAcknowledged } = useQuery<boolean>({ queryKey: ["settings", "bridge-swap-needed-shown"] });
  const { supportedAssets, isPending } = useMarkets();
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
  const native = lifiChains?.find((c) => c.id === chain.id);
  const visible = expanded ? sorted : sorted.slice(0, 3);
  function navigate(chainId: number) {
    router.push({
      pathname: "/add-funds/add-crypto",
      params: chainId === chain.id ? { asset } : { asset, chainId: String(chainId) },
    });
  }
  function selectNetwork(chainId: number) {
    const supported = isPending || supportedAssets.includes(asset);
    const variant = chainId === chain.id ? (supported ? undefined : "swap") : supported ? "bridge" : "bridgeSwap";
    const acknowledged = { bridge: bridgeAcknowledged, bridgeSwap: bridgeSwapAcknowledged, swap: swapAcknowledged };
    if (variant && !acknowledged[variant]) {
      setPending({ chainId, variant });
      return;
    }
    navigate(chainId);
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
                title={native?.name ?? chain.name}
                subtitle={chain.name}
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
                  {visible.map((c) => (
                    <AddFundsOption
                      key={c.id}
                      icon={<ChainLogo chainId={c.id} size={24} />}
                      title={c.name}
                      onPress={() => selectNetwork(c.id)}
                    />
                  ))}
                  {!expanded && sorted.length > 3 && (
                    <AddFundsOption
                      icon={<Search size={24} color="$iconBrandDefault" />}
                      title={t("More networks")}
                      onPress={() => setExpanded(true)}
                    />
                  )}
                </YStack>
              </YStack>
            )}
          </YStack>
        </ScrollView>
        <ReceiveGuideSheet
          open={pending !== undefined}
          variant={pending?.variant ?? "bridge"}
          asset={asset}
          chainId={pending && pending.chainId !== chain.id ? pending.chainId : undefined}
          network={
            pending?.chainId === chain.id
              ? (native?.name ?? chain.name)
              : (sorted.find((c) => c.id === pending?.chainId)?.name ?? "")
          }
          onClose={() => setPending(undefined)}
          onContinue={(hide) => {
            if (pending) {
              if (hide) queryClient.setQueryData(["settings", settingsKeys[pending.variant]], true);
              navigate(pending.chainId);
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
