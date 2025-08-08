import type { Token } from "@lifi/sdk";
import { Search } from "@tamagui/lucide-icons";
import React, { useState, useMemo } from "react";
import { FlatList, Image, Pressable } from "react-native";
import { XStack, YStack, ButtonIcon } from "tamagui";

import useAccountAssets from "../../utils/useAccountAssets";
import Button from "../shared/Button";
import Input from "../shared/Input";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

interface TokenSelectModalProperties {
  open: boolean;
  tokens: Token[];
  selectedToken?: Token | null;
  onSelect: (token: Token) => void;
  onClose: () => void;
  isLoading?: boolean;
  title?: string;
  withBalanceOnly?: boolean;
}

interface TokenListItemProperties {
  token: Token;
  isSelected: boolean;
  onPress: () => void;
}

const formatUSDValue = (value: number) => {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
  });
};

const formatTokenAmount = (amount: bigint, decimals: number) => {
  const tokenAmount = Number(amount) / 10 ** decimals;
  return tokenAmount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(8, Math.max(0, decimals - Math.ceil(Math.log10(Math.max(1, tokenAmount))))),
    useGrouping: false,
  });
};

function TokenListItem({ token, isSelected, onPress }: TokenListItemProperties) {
  const { accountAssets } = useAccountAssets();
  const matchingAsset = accountAssets.find(
    (asset) =>
      (asset.type === "protocol" && asset.asset === token.address) ||
      (asset.type === "external" && asset.address === token.address),
  );
  return (
    <Pressable onPress={onPress}>
      <XStack
        padding="$s4"
        alignItems="center"
        gap="$s3_5"
        backgroundColor={isSelected ? "$interactiveBaseBrandSoftDefault" : "transparent"}
        borderRadius="$r3"
      >
        <Image
          source={{ uri: token.logoURI ?? "https://via.placeholder.com/40" }}
          borderRadius={20}
          style={{ minWidth: 40, minHeight: 40, borderRadius: 99 }} // eslint-disable-line react-native/no-inline-styles
        />
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
              {formatUSDValue(matchingAsset?.usdValue ?? 0)}
            </Text>
            <Text footnote color="$uiNeutralSecondary" textAlign="right">
              {matchingAsset
                ? matchingAsset.type === "protocol"
                  ? formatTokenAmount(matchingAsset.floatingDepositAssets, matchingAsset.decimals)
                  : formatTokenAmount(matchingAsset.amount ?? 0n, matchingAsset.decimals)
                : formatTokenAmount(0n, 0)}
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
  title = "Select Token",
  withBalanceOnly = false,
}: TokenSelectModalProperties) {
  const [searchQuery, setSearchQuery] = useState("");
  const { accountAssets } = useAccountAssets();

  const filteredTokens = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const matchesQuery = (...fields: (string | undefined)[]) =>
      fields.some((field) => field?.toLowerCase().includes(query));
    const matchesAsset = (token: Token) =>
      accountAssets.find(
        (asset) =>
          (asset.type === "protocol" && asset.asset === token.address) ||
          (asset.type === "external" && asset.address === token.address),
      );
    return tokens.filter((token) => {
      if (withBalanceOnly) {
        const asset = matchesAsset(token);
        if (!asset) return false;
        return asset.type === "protocol"
          ? asset.floatingDepositAssets > 0n && matchesQuery(asset.symbol, asset.assetName, asset.asset)
          : (asset.amount ?? 0n) > 0n && matchesQuery(asset.symbol, asset.name, asset.address);
      }
      return matchesQuery(token.symbol, token.name, token.address);
    });
  }, [searchQuery, tokens, withBalanceOnly, accountAssets]);

  const handleTokenSelect = (token: Token) => {
    onSelect(token);
    setSearchQuery("");
  };

  const renderTokenItem = ({ item }: { item: Token }) => (
    <TokenListItem
      token={item}
      isSelected={selectedToken?.address === item.address}
      onPress={() => {
        handleTokenSelect(item);
      }}
    />
  );

  const skeletonItems = useMemo(
    () => (
      <YStack>
        {Array.from({ length: 8 }).map((_, index) => (
          <TokenSkeletonItem key={index} />
        ))}
      </YStack>
    ),
    [],
  );
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag heightPercent={85}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <View padded paddingTop="$s6" fullScreen flex={1}>
          <View paddingBottom="$s4">
            <Text fontSize={20} fontWeight="bold" textAlign="center">
              {title}
            </Text>
          </View>
          <View paddingBottom="$s4" flexDirection="row">
            <Input
              neutral
              flex={1}
              placeholder="Search by token name or address"
              placeholderTextColor="$interactiveTextDisabled"
              borderColor="$uiNeutralTertiary"
              borderRightColor="transparent"
              borderTopRightRadius={0}
              borderBottomRightRadius={0}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <Button
              outlined
              borderColor="$uiNeutralTertiary"
              borderTopLeftRadius={0}
              borderBottomLeftRadius={0}
              borderLeftWidth={0}
            >
              <ButtonIcon>
                <Search size={24} color="$interactiveOnBaseBrandSoft" />
              </ButtonIcon>
            </Button>
          </View>
          <View flex={1}>
            {isLoading ? (
              skeletonItems
            ) : (
              <FlatList
                data={filteredTokens}
                renderItem={renderTokenItem}
                keyExtractor={(item) => item.address}
                showsVerticalScrollIndicator={false}
                ItemSeparatorComponent={() => <View height={1} />}
                ListEmptyComponent={() => (
                  <View padding="$s6" alignItems="center">
                    <Text subHeadline color="$uiNeutralSecondary">
                      {searchQuery ? "No tokens found" : "No tokens available"}
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
