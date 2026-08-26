import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import {
  ArrowLeft,
  BriefcaseBusiness,
  ChartNoAxesCombined,
  CircleHelp,
  Ellipsis,
  Search,
  TrendingUp,
} from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { ChainType } from "@lifi/sdk";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { zeroAddress } from "viem";
import { base } from "viem/chains";

import chain, { marketWETHAddress } from "@exactly/common/generated/chain";
import { withdrawLimit } from "@exactly/lib";

import alchemyChainById from "../../utils/alchemyChains";
import deployedOptions, { isUnsupported } from "../../utils/deployedOptions";
import { presentArticle } from "../../utils/intercom";
import { isStock, lifiChainsOptions, lifiTokensOptions, reachOptions } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import usePortfolio, { type ExternalAsset } from "../../utils/usePortfolio";
import AssetLogo from "../shared/AssetLogo";
import ChainLogo from "../shared/ChainLogo";
import Chip from "../shared/Chip";
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
  const { receiver, ens, chainType } = useLocalSearchParams();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"stocks" | number>();
  const [networks, setNetworks] = useState(false);
  const [unsupported, setUnsupported] = useState<null | { asset: ExternalAsset; chainName: string }>(null);
  const { address } = useAccount();
  const { allAssets, markets, isPending, isBalancesPending } = usePortfolio();
  const { data: advanced } = useQuery<boolean>({ queryKey: ["settings", "advanced-mode"] });
  const { data: chains } = useQuery(lifiChainsOptions);
  const { data: reach, isError: reachFailed, refetch: refetchReach } = useQuery(reachOptions);
  const {
    data: tokens,
    isPending: isTokensPending,
    isError: isTokensError,
    refetch: refetchTokens,
  } = useQuery(lifiTokensOptions);

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
  const { deployedChains, pendingChains } = useQueries({
    queries: crossChainIds.map((chainId) => deployedOptions(address, chainId)),
    combine: useCallback(
      (results: UseQueryResult<boolean>[]) => {
        const pending = new Set<number>();
        const deployed = new Map<number, boolean>();
        for (const [index, chainId] of crossChainIds.entries()) {
          const result = results[index];
          if (!result) continue;
          if (result.isSuccess && typeof result.data === "boolean") deployed.set(chainId, result.data);
          else if (result.isLoading || result.isFetching) pending.add(chainId);
        }
        return { deployedChains: deployed, pendingChains: pending };
      },
      [crossChainIds],
    ),
  });
  const held = useMemo(
    () => new Set(allAssets.flatMap((asset) => (asset.type === "external" ? [asset.chainId] : []))),
    [allAssets],
  );
  const funded = useMemo(() => {
    const totals = new Map<number, number>();
    for (const asset of allAssets) {
      if (asset.type === "protocol" && asset.usdValue <= 0) continue;
      const id = asset.type === "external" ? asset.chainId : chain.id;
      totals.set(id, (totals.get(id) ?? 0) + asset.usdValue);
    }
    return totals;
  }, [allAssets]);
  const targets = useMemo(
    () =>
      new Set(
        [chain.id, ...held].flatMap((id) => (id === chain.id || deployedChains.get(id) ? (reach?.[id] ?? []) : [])),
      ),
    [deployedChains, held, reach],
  );

  const compatible = useCallback(
    (id: number) => {
      if (typeof chainType !== "string") return true;
      const known = chains?.find((item) => item.id === id);
      return known ? known.chainType === (chainType as ChainType) : chainType === (ChainType.EVM as string);
    },
    [chainType, chains],
  );

  const reachable = useMemo(
    () =>
      (chains ?? [])
        .filter((item) => held.has(item.id) || targets.has(item.id))
        .sort((a, b) => {
          if (a.id === chain.id) return -1;
          if (b.id === chain.id) return 1;
          return a.name.localeCompare(b.name);
        })
        .map((item) => ({
          ...item,
          disabled: !compatible(item.id) || (held.has(item.id) && isUnsupported(item.id, deployedChains)),
        })),
    [chains, compatible, deployedChains, held, targets],
  );

  const chips = useMemo(
    () =>
      advanced
        ? [...reachable].sort((a, b) => {
            if (a.id === chain.id) return -1;
            if (b.id === chain.id) return 1;
            if (a.id === base.id) return -1;
            if (b.id === base.id) return 1;
            return (
              Number(a.chainType === ChainType.EVM) - Number(b.chainType === ChainType.EVM) ||
              a.name.localeCompare(b.name)
            );
          })
        : reachable
            .filter((item) => funded.has(item.id))
            .sort((a, b) => (funded.get(b.id) ?? 0) - (funded.get(a.id) ?? 0)),
    [advanced, funded, reachable],
  );

  const pills = useMemo(
    () => [...chips.slice(0, 10), ...chips.slice(10).filter((item) => item.id === filter)],
    [chips, filter],
  );

  const search = query.trim().toLowerCase();

  const owned = useMemo(
    () =>
      filter === "stocks"
        ? []
        : allAssets.filter((asset) => {
            const chainId = asset.type === "external" ? asset.chainId : chain.id;
            if (filter !== undefined && chainId !== filter) return false;
            if (!compatible(chainId)) return false;
            return (
              (asset.type === "external" || asset.usdValue > 0) &&
              (!search || asset.symbol.toLowerCase().includes(search))
            );
          }),
    [allAssets, compatible, filter, search],
  );

  const trending = useMemo(() => {
    if (!advanced) return [];
    const ids = new Set(
      [...targets].filter((id) => compatible(id) && (filter === undefined || filter === "stocks" || id === filter)),
    );
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
          ids.has(token.chainId) &&
          (filter !== "stocks" || isStock(token)) &&
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
  }, [advanced, chains, compatible, tokens, targets, filter, owned, search]);

  if (typeof receiver !== "string" || !receiver) return <Redirect href="/send-funds/receiver" />;

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/send-funds/receiver");
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
          <NetworkFilter
            chains={chips}
            value={typeof filter === "number" ? filter : undefined}
            open={networks}
            icon={
              filter === "stocks" ? <ChartNoAxesCombined size={18} color="$interactiveOnBaseBrandSoft" /> : undefined
            }
            onChange={setFilter}
            onOpenChange={setNetworks}
          />
        </XStack>
        {chips.length > 0 && (
          <ScrollView
            horizontal
            flexGrow={0}
            flexShrink={0}
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <XStack gap="$s3" alignItems="center">
              {(advanced ? [...pills.slice(0, 2), "stocks" as const, ...pills.slice(2)] : pills).map((item) =>
                item === "stocks" ? (
                  <Chip
                    key={item}
                    disabled={!compatible(base.id)}
                    icon={<ChartNoAxesCombined size={16} color="$uiNeutralPrimary" />}
                    label={t("Stocks")}
                    selected={filter === "stocks"}
                    onPress={() => {
                      setFilter(filter === "stocks" ? undefined : "stocks");
                    }}
                  />
                ) : (
                  <Chip
                    key={item.id}
                    disabled={item.disabled}
                    icon={<ChainLogo chainId={item.id} size={16} />}
                    label={item.name}
                    selected={filter === item.id}
                    onPress={() => {
                      setFilter(filter === item.id ? undefined : item.id);
                    }}
                  />
                ),
              )}
              {chips.length > pills.length && (
                <Chip
                  icon={<Ellipsis size={16} color="$uiNeutralPrimary" />}
                  label={t("More")}
                  selected={false}
                  onPress={() => {
                    setNetworks(true);
                  }}
                />
              )}
            </XStack>
          </ScrollView>
        )}
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
                <XStack gap="$s3" alignItems="center">
                  <BriefcaseBusiness size={16} color="$uiNeutralPlaceholder" />
                  <Text subHeadline color="$uiNeutralPlaceholder">
                    {t("Your assets")}
                  </Text>
                </XStack>
                {owned.map((asset) => {
                  const chainId = asset.type === "external" ? asset.chainId : chain.id;
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
                      subtitle={
                        chains?.find((item) => item.id === chainId)?.name ??
                        alchemyChainById.get(chainId)?.name ??
                        chain.name
                      }
                      value={`$${asset.usdValue.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      detail={balance}
                      label={t("{{symbol}}, {{balance}} available", { symbol: asset.symbol, balance })}
                      disabled={asset.type === "external" && isUnsupported(chainId, deployedChains)}
                      pending={asset.type === "external" && pendingChains.has(chainId)}
                      onPress={() => {
                        const chainName =
                          chains?.find((item) => item.id === chainId)?.name ??
                          alchemyChainById.get(chainId)?.name ??
                          chain.name;
                        if (asset.type === "external" && isUnsupported(chainId, deployedChains)) {
                          setUnsupported({ asset, chainName });
                          return;
                        }
                        router.push({
                          pathname: "/send-funds/amount",
                          params: {
                            receiver,
                            ens,
                            chainType,
                            toChain: String(chainId),
                            toToken:
                              asset.type === "external"
                                ? asset.address
                                : asset.market === marketWETHAddress
                                  ? zeroAddress
                                  : asset.asset,
                            ...(advanced
                              ? {}
                              : {
                                  asset: asset.type === "external" ? asset.address : asset.market,
                                  fromChain: String(chainId),
                                }),
                          },
                        });
                      }}
                    />
                  );
                })}
                {(isPending || isBalancesPending) && <Skeleton width="100%" height={40} />}
              </YStack>
            )}
            {advanced && (
              <YStack gap="$s5">
                <XStack gap="$s3" alignItems="center">
                  <TrendingUp size={16} color="$uiNeutralPlaceholder" />
                  <Text subHeadline color="$uiNeutralPlaceholder">
                    {t("Trending last 24h")}
                  </Text>
                </XStack>
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
                      {t("Couldn't load trending assets. Please try again.")}
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
                {trending.map((token) => {
                  const chainName =
                    chains?.find((item) => item.id === (token.chainId as number))?.name ??
                    alchemyChainById.get(token.chainId)?.name ??
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
                          params: {
                            receiver,
                            ens,
                            chainType,
                            toChain: String(token.chainId),
                            toToken: token.address,
                          },
                        });
                      }}
                    />
                  );
                })}
              </YStack>
            )}
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
  disabled,
  label,
  pending,
  onPress,
}: {
  detail?: string;
  disabled?: boolean;
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
      opacity={disabled ? 0.5 : pending ? 0.7 : 1}
      cursor={pending ? "default" : "pointer"}
      role="button"
      aria-label={label}
      aria-busy={pending}
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
    </XStack>
  );
}
