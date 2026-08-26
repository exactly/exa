import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowLeft, CircleHelp, Search } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";
import { withdrawLimit } from "@exactly/lib";

import NetworkFilter from "./NetworkFilter";
import { presentArticle } from "../../utils/intercom";
import { lifiChainsOptions, lifiTokensOptions, reachOptions } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import usePortfolio from "../../utils/usePortfolio";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AssetSelection() {
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState<number>();
  const { allAssets, markets, isPending, isBalancesPending } = usePortfolio();
  const { data: chains } = useQuery(lifiChainsOptions);
  const { data: reach, isError: reachFailed, refetch: refetchReach } = useQuery(reachOptions);
  const { data: tokens, isPending: isTokensPending } = useQuery(lifiTokensOptions);

  const reachable = useMemo(
    () =>
      (chains ?? [])
        .filter((item) => !!reach && (reach.origins.includes(item.id) || reach.destinations.includes(item.id)))
        .sort((a, b) => {
          if (a.id === chain.id) return -1;
          if (b.id === chain.id) return 1;
          return a.name.localeCompare(b.name);
        }),
    [chains, reach],
  );

  const search = query.trim().toLowerCase();

  const owned = useMemo(
    () =>
      allAssets.filter((asset) => {
        const chainId = asset.type === "external" ? asset.chainId : chain.id;
        if (chainId !== chain.id && !reach?.origins.includes(chainId)) return false;
        if (network !== undefined && chainId !== network) return false;
        return asset.usdValue > 0 && (!search || asset.symbol.toLowerCase().includes(search));
      }),
    [allAssets, network, reach, search],
  );

  const popular = useMemo(() => {
    const ids = new Set((reach?.destinations ?? []).filter((id) => (network === undefined ? true : id === network)));
    const held = new Set(
      owned.map((asset) =>
        asset.type === "external"
          ? `${asset.chainId}:${asset.address.toLowerCase()}`
          : `${chain.id}:${asset.asset.toLowerCase()}`,
      ),
    );
    return (tokens ?? [])
      .filter(
        (token) =>
          ids.has(token.chainId) &&
          !held.has(`${token.chainId}:${token.address.toLowerCase()}`) &&
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
  }, [tokens, reach, network, owned, search]);

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
                      subtitle={chains?.find((item) => item.id === chainId)?.name ?? chain.name}
                      value={`$${asset.usdValue.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      detail={balance}
                      label={t("{{symbol}}, {{balance}} available", { symbol: asset.symbol, balance })}
                      onPress={() => {
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
              {popular.map((token) => {
                const chainName = chains?.find((item) => item.id === (token.chainId as number))?.name ?? token.name;
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
  onPress,
}: {
  detail?: string;
  label: string;
  logo: React.ReactNode;
  onPress: () => void;
  subtitle: string;
  title: string;
  value?: string;
}) {
  return (
    <XStack
      gap="$s3"
      alignItems="center"
      cursor="pointer"
      role="button"
      aria-label={label}
      pressStyle={{ opacity: 0.7 }}
      onPress={onPress}
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
