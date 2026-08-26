import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowLeft, CircleHelp, Search } from "@tamagui/lucide-icons";
import { ScrollView, Spinner, XStack, YStack } from "tamagui";

import { useQueries, useQuery, type QueryObserverResult } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";
import { withdrawLimit } from "@exactly/lib";

import alchemyChainById from "../../utils/alchemyChains";
import deployedOptions, { isUnsupported } from "../../utils/deployedOptions";
import { presentArticle } from "../../utils/intercom";
import { lifiChainsOptions, lifiTokensOptions, reachOptions } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import usePortfolio, { type ExternalAsset, type PortfolioAsset } from "../../utils/usePortfolio";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import Input from "../shared/Input";
import NetworkFilter from "../shared/NetworkFilter";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import UnsupportedNetworksSheet from "../shared/UnsupportedNetworksSheet";
import View from "../shared/View";

export default function AssetSelection() {
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState<number>();
  const [unsupported, setUnsupported] = useState<null | { asset: ExternalAsset; chainName: string }>(null);
  const { address } = useAccount();
  const { allAssets, markets, isPending, isBalancesPending } = usePortfolio();
  const { data: chains } = useQuery(lifiChainsOptions);
  const { data: reach, isError: reachFailed, refetch: refetchReach } = useQuery(reachOptions);
  const {
    data: tokens,
    isPending: isTokensPending,
    isError: isTokensError,
    refetch: refetchTokens,
  } = useQuery(lifiTokensOptions);

  const search = query.trim().toLowerCase();

  const owned = useMemo(
    () =>
      allAssets.filter((asset) => {
        const chainId = asset.type === "external" ? asset.chainId : chain.id;
        if (network !== undefined && chainId !== network) return false;
        return (
          (asset.type === "external" || asset.usdValue > 0) && (!search || asset.symbol.toLowerCase().includes(search))
        );
      }),
    [allAssets, network, search],
  );

  const crossChainIds = useMemo(
    () => [
      ...new Set(
        allAssets.flatMap((asset) =>
          asset.type === "external" && asset.chainId !== chain.id && alchemyChainById.has(asset.chainId)
            ? [asset.chainId]
            : [],
        ),
      ),
    ],
    [allAssets],
  );
  const { deployedChains, pendingChains, failedChains } = useQueries({
    queries: crossChainIds.map((chainId) => deployedOptions(address, chainId)),
    combine(results) {
      const pending = new Set<number>();
      const deployed = new Map<number, boolean>();
      const failed = new Map<number, () => Promise<QueryObserverResult<boolean>>>();
      for (const [index, chainId] of crossChainIds.entries()) {
        const result = results[index];
        if (!result) continue;
        if (result.isSuccess && typeof result.data === "boolean") deployed.set(chainId, result.data);
        else if (result.isLoading || result.isFetching) pending.add(chainId);
        else if (result.isError) failed.set(chainId, result.refetch);
      }
      return { deployedChains: deployed, pendingChains: pending, failedChains: failed };
    },
  });
  const held = useMemo(
    () => new Set(allAssets.flatMap((asset) => (asset.type === "external" ? [asset.chainId] : []))),
    [allAssets],
  );
  const targets = useMemo(
    () =>
      new Set(
        [chain.id, ...held].flatMap((id) => (id === chain.id || deployedChains.get(id) ? (reach?.[id] ?? []) : [])),
      ),
    [deployedChains, held, reach],
  );
  const reachable = useMemo(
    () =>
      (chains ?? [])
        .filter((item) => held.has(item.id) || targets.has(item.id))
        .sort((a, b) => {
          if (a.id === chain.id) return -1;
          if (b.id === chain.id) return 1;
          return a.name.localeCompare(b.name);
        }),
    [chains, held, targets],
  );

  const popular = useMemo(() => {
    const native = chains?.find((item) => item.id === chain.id)?.nativeToken;
    const keys = new Set(
      owned.flatMap((asset) =>
        asset.type === "external"
          ? [`${asset.chainId}:${asset.address.toLowerCase()}`]
          : [
              `${chain.id}:${asset.asset.toLowerCase()}`,
              ...(asset.symbol === native?.symbol ? [`${chain.id}:${native.address.toLowerCase()}`] : []),
            ],
      ),
    );
    return (tokens ?? [])
      .filter(
        (token) =>
          targets.has(token.chainId) &&
          (network === undefined || token.chainId === (network as typeof token.chainId)) &&
          !keys.has(`${token.chainId}:${token.address.toLowerCase()}`) &&
          (!search ||
            token.symbol.toLowerCase().includes(search) ||
            token.name.toLowerCase().includes(search) ||
            token.address.toLowerCase() === search),
      )
      .sort(
        (a, b) =>
          Number(b.chainId === (chain.id as typeof b.chainId)) - Number(a.chainId === (chain.id as typeof a.chainId)),
      )
      .slice(0, 20);
  }, [chains, tokens, targets, network, owned, search]);

  function select(asset: PortfolioAsset, chainName: string, deployed: Map<number, boolean>) {
    if (asset.type === "external" && isUnsupported(asset.chainId, deployed)) {
      setUnsupported({ asset, chainName });
      return;
    }
    router.push({
      pathname: "/send-funds/amount",
      params:
        asset.type === "external" && asset.chainId !== chain.id
          ? {
              asset: asset.address,
              fromChain: String(asset.chainId),
              toChain: String(asset.chainId),
              toToken: asset.address,
            }
          : { asset: asset.type === "external" ? asset.address : asset.market },
    });
  }

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/send-funds");
            }}
          />
          <Text emphasized subHeadline primary>
            {t("Select asset to send")}
          </Text>
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("8950801").catch(reportError);
            }}
          />
        </XStack>
        <XStack
          alignItems="center"
          gap="$s2"
          paddingLeft="$s3_5"
          borderWidth={1}
          borderColor="$borderNeutralSoft"
          borderRadius="$r3"
          overflow="hidden"
        >
          <Search size={20} color="$uiNeutralPlaceholder" />
          <Input
            flex={1}
            borderWidth={0}
            backgroundColor="transparent"
            placeholder={t("Search assets")}
            placeholderTextColor="$uiNeutralPlaceholder"
            value={query}
            onChangeText={setQuery}
          />
          <NetworkFilter chains={reachable} value={network} onChange={setNetwork} />
        </XStack>
        {reachFailed && (
          <XStack
            gap="$s3"
            alignItems="center"
            justifyContent="space-between"
            padding="$s3_5"
            borderRadius="$r3"
            backgroundColor="$uiNeutralTertiary"
          >
            <Text flex={1} subHeadline color="$uiNeutralSecondary">
              {t("Couldn't load networks. Please try again.")}
            </Text>
            <Text
              emphasized
              subHeadline
              role="button"
              aria-label={t("Retry")}
              cursor="pointer"
              color="$interactiveBaseBrandDefault"
              pressStyle={{ opacity: 0.7 }}
              onPress={() => {
                refetchReach().catch(reportError);
              }}
            >
              {t("Retry")}
            </Text>
          </XStack>
        )}
        <ScrollView flex={1} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <YStack flex={1} gap="$s6">
            {(owned.length > 0 || isPending || isBalancesPending) && (
              <YStack gap="$s5">
                <Text subHeadline color="$uiNeutralPlaceholder">
                  {t("Your assets")}
                </Text>
                {owned.map((asset) => {
                  const chainId = asset.type === "external" ? asset.chainId : chain.id;
                  const chainName =
                    chains?.find((item) => item.id === chainId)?.name ??
                    alchemyChainById.get(chainId)?.name ??
                    chain.name;
                  const available =
                    asset.type === "external"
                      ? (asset.amount ?? 0n)
                      : markets
                        ? withdrawLimit(markets, asset.market)
                        : 0n;
                  const usdPrice = asset.type === "external" ? Number(asset.priceUSD) : Number(asset.usdPrice) / 1e18;
                  const balance = (Number(available) / 10 ** asset.decimals).toLocaleString(language, {
                    maximumFractionDigits: Math.min(
                      8,
                      Math.max(0, asset.decimals - Math.ceil(Math.log10(Math.max(1, usdPrice)))),
                    ),
                  });
                  return (
                    <Row
                      key={asset.type === "external" ? `${asset.chainId}:${asset.address}` : asset.market}
                      logo={
                        <AssetLogo
                          uri={asset.type === "external" ? asset.logoURI : undefined}
                          symbol={asset.symbol}
                          width={40}
                          height={40}
                          chainId={chainId}
                          network
                        />
                      }
                      title={asset.symbol}
                      subtitle={chainName}
                      value={`$${asset.usdValue.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      detail={balance}
                      label={t("{{symbol}}, {{balance}} available", { symbol: asset.symbol, balance })}
                      pending={asset.type === "external" && pendingChains.has(chainId)}
                      onPress={() => {
                        const retry = asset.type === "external" ? failedChains.get(chainId) : undefined;
                        if (!retry) {
                          select(asset, chainName, deployedChains);
                          return;
                        }
                        retry()
                          .then((result) => {
                            if (result.isSuccess) select(asset, chainName, new Map([[chainId, result.data]]));
                          })
                          .catch(reportError);
                      }}
                    />
                  );
                })}
                {(isPending || isBalancesPending) && <Skeleton width="100%" height={40} />}
              </YStack>
            )}
            <YStack gap="$s5">
              <Text subHeadline color="$uiNeutralPlaceholder">
                {t("Popular assets")}
              </Text>
              {isTokensPending && <Skeleton width="100%" height={40} />}
              {isTokensError && !tokens && (
                <XStack
                  gap="$s3"
                  alignItems="center"
                  justifyContent="space-between"
                  padding="$s3_5"
                  borderRadius="$r3"
                  backgroundColor="$uiNeutralTertiary"
                >
                  <Text flex={1} subHeadline color="$uiNeutralSecondary">
                    {t("Couldn't load popular assets. Please try again.")}
                  </Text>
                  <Text
                    emphasized
                    subHeadline
                    role="button"
                    aria-label={t("Retry")}
                    cursor="pointer"
                    color="$interactiveBaseBrandDefault"
                    pressStyle={{ opacity: 0.7 }}
                    onPress={() => {
                      refetchTokens().catch(reportError);
                    }}
                  >
                    {t("Retry")}
                  </Text>
                </XStack>
              )}
              {popular.map((token) => {
                const chainId = token.chainId as number;
                const chainName =
                  chains?.find((item) => item.id === chainId)?.name ??
                  alchemyChainById.get(chainId)?.name ??
                  chain.name;
                return (
                  <Row
                    key={`${token.chainId}:${token.address}`}
                    logo={
                      <AssetLogo
                        uri={token.logoURI}
                        symbol={token.symbol}
                        width={40}
                        height={40}
                        chainId={token.chainId}
                        network
                      />
                    }
                    title={token.symbol}
                    subtitle={chainName}
                    label={t("{{symbol}} on {{network}}", { symbol: token.symbol, network: chainName })}
                    onPress={() => {
                      router.push({
                        pathname: "/send-funds/amount",
                        params: { toChain: String(token.chainId), toToken: token.address },
                      });
                    }}
                  />
                );
              })}
            </YStack>
          </YStack>
        </ScrollView>
      </View>
      <UnsupportedNetworksSheet
        open={unsupported !== null}
        asset={unsupported?.asset}
        chainName={unsupported?.chainName}
        onClose={() => {
          setUnsupported(null);
        }}
      />
    </SafeView>
  );
}

function Row({
  logo,
  title,
  subtitle,
  value,
  detail,
  label,
  pending,
  onPress,
}: {
  detail?: string;
  label: string;
  logo: React.ReactNode;
  onPress: () => void;
  pending?: boolean;
  subtitle: string;
  title: string;
  value?: string;
}) {
  return (
    <XStack
      gap="$s3"
      alignItems="center"
      cursor={pending ? "default" : "pointer"}
      role="button"
      aria-label={label}
      aria-busy={pending}
      opacity={pending ? 0.7 : 1}
      pressStyle={pending ? undefined : { opacity: 0.7 }}
      onPress={pending ? undefined : onPress}
    >
      {logo}
      <YStack gap="$s2" flex={1}>
        <Text emphasized callout primary numberOfLines={1}>
          {title}
        </Text>
        <Text footnote secondary numberOfLines={1}>
          {subtitle}
        </Text>
      </YStack>
      {!!value && (
        <YStack gap="$s2" alignItems="flex-end">
          <Text emphasized callout primary>
            {value}
          </Text>
          <Text caption secondary>
            {detail}
          </Text>
        </YStack>
      )}
      {pending && <Spinner size="small" color="$interactiveOnBaseBrandSoft" />}
    </XStack>
  );
}
