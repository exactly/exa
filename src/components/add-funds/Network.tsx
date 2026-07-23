import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, CircleHelp, Info, Search } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQueries, useQuery } from "@tanstack/react-query";
import { arbitrum, base, bsc, mainnet, polygon } from "viem/chains";

import chain, { allowlists } from "@exactly/common/generated/chain";

import AddFundsOption from "./AddFundsOption";
import EducationSheet from "./EducationSheet";
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
  const [expanded, setExpanded] = useState(false);
  const [nativeShown, setNativeShown] = useState(false);
  const [othersShown, setOthersShown] = useState(false);
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
  const native = lifiChains?.find((c) => c.id === chain.id);
  const receivable = isPending || !tokens || supportedAssets.includes(asset) || symbols.has(chain.id);
  const visible = expanded ? deployable : deployable.slice(0, 3);
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
                <XStack gap="$s2" alignItems="center">
                  <Text emphasized primary headline>
                    {t("Native network")}
                  </Text>
                  <Pressable
                    role="button"
                    aria-label={t("Native network")}
                    hitSlop={15}
                    onPress={() => setNativeShown(true)}
                  >
                    <Info size={16} color="$uiBrandSecondary" />
                  </Pressable>
                </XStack>
                <AddFundsOption
                  icon={<ChainLogo chainId={chain.id} size={24} />}
                  title={native?.name ?? chain.name}
                  subtitle={chain.name}
                  badge={t("Recommended")}
                  onPress={() => selectNetwork(chain.id)}
                />
              </YStack>
            )}
            {deployable.length > 0 && (
              <YStack gap="$s4">
                <XStack gap="$s2" alignItems="center">
                  <Text emphasized primary headline>
                    {t("Other networks")}
                  </Text>
                  <Pressable
                    role="button"
                    aria-label={t("Other networks")}
                    hitSlop={15}
                    onPress={() => setOthersShown(true)}
                  >
                    <Info size={16} color="$uiBrandSecondary" />
                  </Pressable>
                </XStack>
                <YStack gap="$s3_5">
                  {visible.map((c) => (
                    <AddFundsOption
                      key={c.id}
                      icon={<ChainLogo chainId={c.id} size={24} />}
                      title={c.name}
                      onPress={() => selectNetwork(c.id)}
                    />
                  ))}
                  {!expanded && deployable.length > 3 && (
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
        <EducationSheet
          open={nativeShown}
          onClose={() => {
            setNativeShown(false);
          }}
          title={t("Native network")}
          article="8950801"
        >
          <XStack
            backgroundColor="$backgroundStrong"
            borderRadius="$r3"
            paddingVertical="$s5"
            paddingHorizontal="$s3_5"
            justifyContent="center"
            alignItems="center"
            gap="$s3"
          >
            <ChainLogo size={40} />
            <YStack>
              <Text emphasized title2 primary>
                {native?.name ?? chain.name}
              </Text>
              <Text callout secondary>
                {chain.name}
              </Text>
            </YStack>
          </XStack>
          <Text subHeadline secondary>
            {t(
              "{{chain}} is Exa App's native network. Supported assets received here generate yield and increase your Exa Card credit limit immediately. Other assets need to be swapped to a supported asset first.",
              { chain: chain.name },
            )}
          </Text>
        </EducationSheet>
        <EducationSheet
          open={othersShown}
          onClose={() => {
            setOthersShown(false);
          }}
          title={t("Other networks")}
          article="8950801"
        >
          <Text subHeadline secondary>
            {t(
              "Assets from these networks need to be bridged to {{chain}}. Some may also require a swap to a supported asset to generate yield and increase your Exa Card credit limit. You can do both from your Portfolio.",
              { chain: chain.name },
            )}
          </Text>
        </EducationSheet>
        <ReceiveGuideSheet
          open={pending !== undefined}
          variant={pending?.variant ?? "bridge"}
          asset={asset}
          symbol={pending?.symbol ?? asset}
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
