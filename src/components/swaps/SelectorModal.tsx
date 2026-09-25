import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable } from "react-native";

import { ChartNoAxesCombined, Ellipsis, Search } from "@tamagui/lucide-icons-2";
import { ScrollView, XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import formatTokenAmount from "../../utils/formatTokenAmount";
import { isStock } from "../../utils/lifi";
import useMarkets from "../../utils/useMarkets";
import usePortfolio, { type PortfolioAsset } from "../../utils/usePortfolio";
import AssetLogo from "../shared/AssetLogo";
import ChainLogo from "../shared/ChainLogo";
import Chip from "../shared/Chip";
import Input from "../shared/Input";
import ModalSheet from "../shared/ModalSheet";
import NetworkFilter from "../shared/NetworkFilter";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Token } from "@lifi/sdk";

function TokenListItem({
  token,
  isSelected,
  onPress,
  language,
  matchingAsset,
}: {
  isSelected: boolean;
  language: string;
  matchingAsset?: PortfolioAsset;
  onPress: () => void;
  token: Token;
}) {
  return (
    <Pressable onPress={onPress}>
      <XStack
        alignItems="center"
        gap="$s3"
        paddingVertical="$s3_5"
        backgroundColor={isSelected ? "$interactiveBaseBrandSoftDefault" : "transparent"}
        borderRadius="$r3"
      >
        <AssetLogo symbol={token.symbol} uri={token.logoURI} chainId={token.chainId} width={40} height={40} network />
        <XStack gap="$s2" flex={1} justifyContent="space-between">
          <YStack flex={1}>
            <Text emphasized subHeadline textAlign="left">
              {token.symbol}
            </Text>
            <Text footnote color="$uiNeutralSecondary" numberOfLines={1} textAlign="left">
              {token.name}
            </Text>
          </YStack>
          <YStack alignItems="flex-end" justifyContent="flex-end" gap="$s2">
            <Text emphasized callout color="$uiNeutralPrimary" textAlign="right">
              {formatUSDValue(
                matchingAsset?.type === "protocol"
                  ? Number(
                      (matchingAsset.floatingDepositAssets * matchingAsset.usdPrice) /
                        BigInt(10 ** matchingAsset.decimals),
                    ) / 1e18
                  : (matchingAsset?.usdValue ?? 0),
                language,
              )}
            </Text>
            <Text footnote color="$uiNeutralSecondary" textAlign="right">
              {matchingAsset
                ? matchingAsset.type === "protocol"
                  ? formatTokenAmount(matchingAsset.floatingDepositAssets, matchingAsset.decimals, language)
                  : formatTokenAmount(matchingAsset.amount ?? 0n, matchingAsset.decimals, language)
                : formatTokenAmount(0n, 0, language)}
            </Text>
          </YStack>
        </XStack>
      </XStack>
    </Pressable>
  );
}

function TokenSkeletonItem() {
  return (
    <XStack alignItems="center" gap="$s3" paddingVertical="$s3_5">
      <Skeleton radius="round" height={40} width={40} />
      <YStack flex={1} gap="$s2">
        <Skeleton height={16} width={60} />
        <Skeleton height={12} width={120} />
      </YStack>
    </XStack>
  );
}

export default function TokenSelectModal({
  open,
  tokens,
  selectedToken,
  onSelect,
  onClose,
  isLoading = false,
  title,
  withBalanceOnly = false,
  networks = empty,
}: {
  isLoading?: boolean;
  networks?: { id: number; name: string }[];
  onClose: () => void;
  onSelect: (token: Token) => void;
  open: boolean;
  selectedToken?: null | Token;
  title?: string;
  tokens: Token[];
  withBalanceOnly?: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"stocks" | number>();
  const [picking, setPicking] = useState(false);
  const { allAssets } = usePortfolio();
  const { markets } = useMarkets();
  const {
    t,
    i18n: { language },
  } = useTranslation();

  const assetByToken = useMemo(() => {
    const map = new Map<string, PortfolioAsset>();
    for (const asset of allAssets) {
      const key = asset.type === "protocol" ? `${chain.id}:${asset.asset}` : `${asset.chainId}:${asset.address}`;
      if (map.get(key)?.type === "protocol") continue;
      map.set(key, asset);
    }
    return map;
  }, [allAssets]);

  const marketAssets = useMemo(() => new Set((markets ?? []).map(({ asset }) => `${chain.id}:${asset}`)), [markets]);

  const pills = useMemo(
    () => [...networks.slice(0, 10), ...networks.slice(10).filter(({ id }) => id === filter)],
    [filter, networks],
  );

  const chips = useMemo(
    () =>
      tokens.some((token) => isStock(token)) ? [...pills.slice(0, 2), "stocks" as const, ...pills.slice(2)] : pills,
    [pills, tokens],
  );

  const filteredTokens = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const matchesQuery = (...fields: (string | undefined)[]) =>
      !query || fields.some((field) => field?.toLowerCase().includes(query));
    return tokens.filter((token) => {
      if (filter === "stocks" && !isStock(token)) return false;
      if (typeof filter === "number" && (token.chainId as number) !== filter) return false;
      if (withBalanceOnly) {
        const key = `${token.chainId}:${token.address}`;
        const asset = assetByToken.get(key);
        if (!asset) return false;
        if (asset.type === "protocol")
          return asset.floatingDepositAssets > 0n && matchesQuery(asset.symbol, asset.assetName, asset.asset);
        if (marketAssets.has(key)) return false;
        return (asset.amount ?? 0n) > 0n && matchesQuery(asset.symbol, asset.name, asset.address);
      }
      return matchesQuery(token.symbol, token.name, token.address);
    });
  }, [searchQuery, tokens, filter, withBalanceOnly, assetByToken, marketAssets]);

  return (
    <ModalSheet open={open} onClose={onClose} disableDrag heightPercent={85}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <View padded paddingTop="$s6" fullScreen flex={1} gap="$s4_5">
          <Text fontSize={20} fontWeight="bold" textAlign="center">
            {title ?? t("Select token")}
          </Text>
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
              placeholder={t("Search by token name or address")}
              placeholderTextColor="$uiNeutralPlaceholder"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {networks.length > 1 && (
              <NetworkFilter
                chains={networks}
                value={typeof filter === "number" ? filter : undefined}
                open={picking}
                icon={
                  filter === "stocks" ? (
                    <ChartNoAxesCombined size={18} color="$interactiveOnBaseBrandSoft" />
                  ) : undefined
                }
                onChange={setFilter}
                onOpenChange={setPicking}
              />
            )}
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
                {chips.map((item) =>
                  item === "stocks" ? (
                    <Chip
                      key={item}
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
                      icon={<ChainLogo chainId={item.id} size={16} />}
                      label={item.name}
                      selected={filter === item.id}
                      onPress={() => {
                        setFilter(filter === item.id ? undefined : item.id);
                      }}
                    />
                  ),
                )}
                {networks.length > 1 && (
                  <Chip
                    icon={<Ellipsis size={16} color="$uiNeutralPrimary" />}
                    label={t("More")}
                    selected={false}
                    onPress={() => {
                      setPicking(true);
                    }}
                  />
                )}
              </XStack>
            </ScrollView>
          )}
          <View flex={1}>
            {isLoading ? (
              <SkeletonItems />
            ) : (
              <FlatList
                data={filteredTokens}
                renderItem={({ item }) => (
                  <TokenListItem
                    token={item}
                    isSelected={selectedToken?.address === item.address && selectedToken.chainId === item.chainId}
                    onPress={() => {
                      onSelect(item);
                      setSearchQuery("");
                    }}
                    language={language}
                    matchingAsset={assetByToken.get(`${item.chainId}:${item.address}`)}
                  />
                )}
                keyExtractor={(item) => `${item.chainId}:${item.address}`}
                showsVerticalScrollIndicator={false}
                windowSize={5}
                ListEmptyComponent={() => (
                  <View padding="$s6" alignItems="center">
                    <Text subHeadline color="$uiNeutralSecondary">
                      {searchQuery ? t("No tokens found") : t("No tokens available")}
                    </Text>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </SafeView>
    </ModalSheet>
  );
}

function SkeletonItems() {
  return (
    <YStack>
      {Array.from({ length: 8 }).map((_, index) => (
        <TokenSkeletonItem key={index} /> // eslint-disable-line @eslint-react/no-array-index-key
      ))}
    </YStack>
  );
}

const empty: { id: number; name: string }[] = [];

function formatUSDValue(value: number, language: string) {
  return `$${value.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
