import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable } from "react-native";

import { Search } from "@tamagui/lucide-icons";
import { ButtonIcon, XStack, YStack } from "tamagui";

import { formatUnits } from "viem";

import usePortfolio from "../../utils/usePortfolio";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/Button";
import Input from "../shared/Input";
import ModalSheet from "../shared/ModalSheet";
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
}: {
  isSelected: boolean;
  language: string;
  onPress: () => void;
  token: Token;
}) {
  const { assets } = usePortfolio();
  const matchingAsset = assets.find(
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
        <AssetLogo source={{ uri: token.logoURI ?? "https://via.placeholder.com/40" }} width={40} height={40} />
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
              {formatUSDValue(matchingAsset?.usdValue ?? 0, language)}
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
}: {
  isLoading?: boolean;
  onClose: () => void;
  onSelect: (token: Token) => void;
  open: boolean;
  selectedToken?: null | Token;
  title?: string;
  tokens: Token[];
  withBalanceOnly?: boolean;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const { assets } = usePortfolio();
  const {
    t,
    i18n: { language },
  } = useTranslation();

  const filteredTokens = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const matchesQuery = (...fields: (string | undefined)[]) =>
      fields.some((field) => field?.toLowerCase().includes(query));
    const matchesAsset = (token: Token) =>
      assets.find(
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
  }, [searchQuery, tokens, withBalanceOnly, assets]);

  return (
    <ModalSheet open={open} onClose={onClose} disableDrag heightPercent={85}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <View padded paddingTop="$s6" fullScreen flex={1}>
          <View paddingBottom="$s4">
            <Text fontSize={20} fontWeight="bold" textAlign="center">
              {title ?? t("Select token")}
            </Text>
          </View>
          <View paddingBottom="$s4" flexDirection="row">
            <Input
              flex={1}
              placeholder={t("Search by token name or address")}
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
              <SkeletonItems />
            ) : (
              <FlatList
                data={filteredTokens}
                renderItem={({ item }) => (
                  <TokenListItem
                    token={item}
                    isSelected={selectedToken?.address === item.address}
                    onPress={() => {
                      onSelect(item);
                      setSearchQuery("");
                    }}
                    language={language}
                  />
                )}
                keyExtractor={(item) => item.address}
                showsVerticalScrollIndicator={false}
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

function formatTokenAmount(amount: bigint, decimals: number, language: string) {
  const tokenAmount = Number(formatUnits(amount, decimals));
  if (tokenAmount === 0) return "0";
  return tokenAmount.toLocaleString(language, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(8, Math.max(0, decimals - Math.ceil(Math.log10(tokenAmount)))),
  });
}
