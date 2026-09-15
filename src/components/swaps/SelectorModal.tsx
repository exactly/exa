import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable } from "react-native";

import { Search } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import formatTokenAmount from "../../utils/formatTokenAmount";
import useMarkets from "../../utils/useMarkets";
import usePortfolio, { type PortfolioAsset } from "../../utils/usePortfolio";
import AssetLogo from "../shared/AssetLogo";
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
  network,
}: {
  isSelected: boolean;
  language: string;
  matchingAsset?: PortfolioAsset;
  network?: string;
  onPress: () => void;
  token: Token;
}) {
  return (
    <Pressable onPress={onPress}>
      <XStack
        padding="$s4"
        alignItems="center"
        gap="$s3_5"
        backgroundColor={isSelected ? "$interactiveBaseBrandSoftDefault" : "transparent"}
        borderRadius="$r3"
      >
        <AssetLogo symbol={token.symbol} uri={token.logoURI} chainId={token.chainId} width={40} height={40} />
        <XStack gap="$s2" flex={1} justifyContent="space-between">
          <YStack flex={1}>
            <Text emphasized subHeadline textAlign="left">
              {token.symbol}
            </Text>
            <Text footnote color="$uiNeutralSecondary" numberOfLines={1} textAlign="left">
              {network ? `${token.name} · ${network}` : token.name}
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
    <XStack padding="$s4" alignItems="center" gap="$s3_5">
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
  networks,
  chainId,
}: {
  chainId?: number;
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
  const [network, setNetwork] = useState(withBalanceOnly ? undefined : chainId);
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

  const filteredTokens = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const matchesQuery = (...fields: (string | undefined)[]) =>
      !query || fields.some((field) => field?.toLowerCase().includes(query));
    return tokens.filter((token) => {
      if (network !== undefined && (token.chainId as number) !== network) return false;
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
  }, [searchQuery, tokens, network, withBalanceOnly, assetByToken, marketAssets]);

  return (
    <ModalSheet open={open} onClose={onClose} disableDrag heightPercent={85}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <View padded paddingTop="$s6" fullScreen flex={1}>
          <View paddingBottom="$s4">
            <Text fontSize={20} fontWeight="bold" textAlign="center">
              {title ?? t("Select token")}
            </Text>
          </View>
          <XStack
            alignItems="center"
            gap="$s2"
            paddingLeft="$s3"
            marginBottom="$s4"
            borderWidth={1}
            borderColor="$borderNeutralSoft"
            borderRadius="$r3"
            overflow="hidden"
          >
            <Search size={16} color="$uiNeutralSecondary" />
            <Input
              flex={1}
              borderWidth={0}
              backgroundColor="transparent"
              placeholder={t("Search by token name or address")}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {networks && networks.length > 1 ? (
              <NetworkFilter
                chains={networks}
                value={network}
                onChange={setNetwork}
                all={withBalanceOnly}
                role="button"
                aria-label={t("Select network")}
              />
            ) : null}
          </XStack>
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
                    network={
                      (item.chainId as number) === chain.id
                        ? undefined
                        : networks?.find(({ id }) => id === (item.chainId as number))?.name
                    }
                  />
                )}
                keyExtractor={(item) => `${item.chainId}:${item.address}`}
                showsVerticalScrollIndicator={false}
                windowSize={5}
                ItemSeparatorComponent={() => <View height={1} />}
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

function formatUSDValue(value: number, language: string) {
  return `$${value.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
