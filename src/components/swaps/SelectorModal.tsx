import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable } from "react-native";

import { ChartNoAxesCombined } from "@tamagui/lucide-icons-2/icons/ChartNoAxesCombined";
import { Ellipsis } from "@tamagui/lucide-icons-2/icons/Ellipsis";
import { Search } from "@tamagui/lucide-icons-2/icons/Search";
import { X } from "@tamagui/lucide-icons-2/icons/X";
import { ScrollView, XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import formatTokenAmount from "../../utils/formatTokenAmount";
import { isStock } from "../../utils/lifi";
import useMarkets from "../../utils/useMarkets";
import usePortfolio, { type PortfolioAsset } from "../../utils/usePortfolio";
import AssetLogo from "../shared/AssetLogo";
import ChainLogo from "../shared/ChainLogo";
import Chip from "../shared/Chip";
import IconButton from "../shared/IconButton";
import Input from "../shared/Input";
import ModalSheet, { Inset } from "../shared/ModalSheet";
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
        gap="s3"
        paddingVertical="s3_5"
        paddingHorizontal="s3"
        backgroundColor={isSelected ? "interactiveBaseBrandSoftDefault" : "transparent"}
        borderRadius="r3"
      >
        <AssetLogo symbol={token.symbol} uri={token.logoURI} chainId={token.chainId} width={40} height={40} network />
        <XStack gap="s2" flex={1} justifyContent="space-between">
          <YStack flex={1}>
            <Text emphasized subHeadline textAlign="left">
              {token.symbol}
            </Text>
            <Text footnote color="uiNeutralSecondary" numberOfLines={1} textAlign="left">
              {token.name}
            </Text>
          </YStack>
          <YStack alignItems="flex-end" justifyContent="flex-end" gap="s2">
            <Text emphasized callout color="uiNeutralPrimary" textAlign="right">
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
            <Text footnote color="uiNeutralSecondary" textAlign="right">
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
    <XStack alignItems="center" gap="s3" paddingVertical="s3_5" paddingHorizontal="s3">
      <Skeleton radius="round" height={40} width={40} />
      <YStack flex={1} gap="s2">
        <Skeleton height={16} width={60} />
        <Skeleton height={12} width={120} />
      </YStack>
    </XStack>
  );
}

export default function TokenSelectModal({
  open,
  tokens,
  selected,
  onSelect,
  onClose,
  isLoading = false,
  title,
  withBalanceOnly = false,
  networks = empty,
  onStocks,
}: {
  isLoading?: boolean;
  networks?: { id: number; name: string }[];
  onClose: () => void;
  onSelect: (token: Token, external?: boolean) => void;
  onStocks?: () => void;
  open: boolean;
  selected?: { external: boolean; token: Token };
  title?: string;
  tokens: Token[];
  withBalanceOnly?: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selection, setSelection] = useState<"stocks" | number>();
  const [picking, setPicking] = useState(false);
  const { allAssets, isExternal } = usePortfolio();
  const { markets } = useMarkets();
  const {
    t,
    i18n: { language },
  } = useTranslation();

  const holdings = useMemo(() => {
    const map = new Map<string, PortfolioAsset[]>();
    for (const asset of allAssets) {
      const key = asset.type === "protocol" ? `${chain.id}:${asset.asset}` : `${asset.chainId}:${asset.address}`;
      map.set(key, asset.type === "protocol" ? [asset, ...(map.get(key) ?? [])] : [...(map.get(key) ?? []), asset]);
    }
    return map;
  }, [allAssets]);

  const marketAssets = useMemo(() => new Set((markets ?? []).map(({ asset }) => `${chain.id}:${asset}`)), [markets]);

  const hasStocks = useMemo(
    () => !!onStocks || new Set(tokens.map((token) => isStock(token))).size > 1,
    [onStocks, tokens],
  );
  const filter = (selection === "stocks" ? hasStocks : networks.some(({ id }) => id === selection))
    ? selection
    : undefined;

  const pills = useMemo(
    () => [...networks.slice(0, 10), ...networks.slice(10).filter(({ id }) => id === filter)],
    [filter, networks],
  );

  const chips = useMemo(() => (hasStocks ? ["stocks" as const, ...pills] : pills), [hasStocks, pills]);

  const filteredTokens = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const matchesQuery = (...fields: (string | undefined)[]) =>
      !query || fields.some((field) => field?.toLowerCase().includes(query));
    return tokens.flatMap<{ asset?: PortfolioAsset; external?: boolean; token: Token }>((token) => {
      if (filter === "stocks" && !isStock(token)) return [];
      if (typeof filter === "number" && (token.chainId as number) !== filter) return [];
      const key = `${token.chainId}:${token.address}`;
      const assets = holdings.get(key) ?? [];
      if (!withBalanceOnly)
        return matchesQuery(token.symbol, token.name, token.address)
          ? [
              {
                token,
                asset: assets.find(({ type }) => (type === "external") === isExternal(token.chainId, token.address)),
              },
            ]
          : [];
      return assets
        .filter((asset) =>
          asset.type === "protocol"
            ? asset.floatingDepositAssets > 0n && matchesQuery(asset.symbol, asset.assetName, asset.asset)
            : (asset.amount ?? 0n) > 0n &&
              (!marketAssets.has(key) || isExternal(asset.chainId, asset.address)) &&
              matchesQuery(asset.symbol, asset.name, asset.address),
        )
        .map((asset) => ({ token, asset, external: asset.type === "external" }));
    });
  }, [searchQuery, tokens, filter, withBalanceOnly, holdings, marketAssets, isExternal]);

  function close() {
    setSearchQuery("");
    onClose();
  }

  return (
    <ModalSheet
      open={open}
      onClose={close}
      disableDrag
      heightPercent={85}
      backgroundColor="backgroundMild"
      moveOnKeyboardChange={false}
      scrollsUnderInset
    >
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="r4" borderTopRightRadius="r4">
        <View paddingTop="s6" fullScreen flex={1} gap="s4_5">
          <XStack alignItems="center" justifyContent="center" marginHorizontal="s4">
            <Text fontSize={20} fontWeight="bold" textAlign="center" paddingHorizontal="s6">
              {title ?? t("Select token")}
            </Text>
            <IconButton position="absolute" right={0} icon={X} aria-label={t("Close")} onPress={close} />
          </XStack>
          <XStack
            alignItems="center"
            gap="s2"
            marginHorizontal="s4"
            paddingLeft="s3_5"
            borderWidth={1}
            borderColor="borderNeutralSoft"
            borderRadius="r3"
            overflow="hidden"
          >
            <Search size={20} color="uiNeutralPlaceholder" />
            <Input
              flex={1}
              borderWidth={0}
              backgroundColor="transparent"
              placeholderTextColor="uiNeutralPlaceholder"
              placeholder={t("Search by token name or address")}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {networks.length > 1 && (
              <NetworkFilter
                chains={networks}
                value={typeof filter === "number" ? filter : undefined}
                open={picking}
                icon={
                  filter === "stocks" ? <ChartNoAxesCombined size={18} color="interactiveOnBaseBrandSoft" /> : undefined
                }
                onChange={setSelection}
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
              <XStack gap="s3" alignItems="center" paddingHorizontal="s4">
                {chips.map((item) =>
                  item === "stocks" ? (
                    <Chip
                      key={item}
                      icon={<ChartNoAxesCombined size={16} color="uiNeutralPrimary" />}
                      label={t("Stocks")}
                      selected={filter === "stocks"}
                      onPress={() => {
                        setSelection(onStocks || filter === "stocks" ? undefined : "stocks");
                        if (!onStocks) return;
                        setSearchQuery("");
                        onStocks();
                      }}
                    />
                  ) : (
                    <Chip
                      key={item.id}
                      icon={<ChainLogo chainId={item.id} size={16} />}
                      label={item.name}
                      selected={filter === item.id}
                      onPress={() => {
                        setSelection(filter === item.id ? undefined : item.id);
                      }}
                    />
                  ),
                )}
                {networks.length > 1 && (
                  <Chip
                    icon={<Ellipsis size={16} color="uiNeutralPrimary" />}
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
          <View flex={1} paddingHorizontal="s3">
            {isLoading ? (
              <SkeletonItems />
            ) : (
              <FlatList
                data={filteredTokens}
                renderItem={({ item }) => (
                  <TokenListItem
                    token={item.token}
                    isSelected={
                      selected?.token.address === item.token.address &&
                      selected.token.chainId === item.token.chainId &&
                      (item.external === undefined || item.external === selected.external)
                    }
                    onPress={() => {
                      onSelect(item.token, item.external);
                      setSearchQuery("");
                    }}
                    language={language}
                    matchingAsset={item.asset}
                  />
                )}
                keyExtractor={({ token, external }) => `${token.chainId}:${token.address}:${external}`}
                showsVerticalScrollIndicator={false}
                keyboardDismissMode="on-drag"
                ListFooterComponent={<Inset keyboard offset="s3_5" />}
                windowSize={5}
                ListEmptyComponent={() => (
                  <View padding="s6" alignItems="center">
                    <Text subHeadline color="uiNeutralSecondary">
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
