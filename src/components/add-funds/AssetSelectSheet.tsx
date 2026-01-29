import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Search } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { formatUnits } from "viem";

import AssetLogo from "../shared/AssetLogo";
import Input from "../shared/Input";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Chain, Token } from "@lifi/sdk";

export default function AssetSelectSheet({
  open,
  groups,
  selected,
  onSelect,
  onClose,
  hideBalances = false,
  label,
}: {
  groups: {
    assets: { balance: bigint; token: Token; usdValue: number }[];
    chain: Pick<Chain, "id" | "logoURI" | "name">;
  }[];
  hideBalances?: boolean;
  label?: string;
  onClose: () => void;
  onSelect: (chainId: number, token: Token) => void;
  open: boolean;
  selected?: { address: string; chain: number };
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const displayLabel = label ?? t("Select asset");

  const filteredGroups = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return groups
      .map((group) => {
        if (!normalizedQuery) return group;
        const assets = group.assets.filter(({ token }) => {
          const symbol = token.symbol.toLowerCase();
          const name = token.name.toLowerCase();
          const address = token.address.toLowerCase();
          return (
            symbol.includes(normalizedQuery) || name.includes(normalizedQuery) || address.includes(normalizedQuery)
          );
        });
        return { ...group, assets };
      })
      .filter((group) => group.assets.length > 0);
  }, [groups, searchQuery]);

  const handleClose = useCallback(() => {
    setSearchQuery("");
    onClose();
  }, [onClose]);

  return (
    <ModalSheet open={open} onClose={handleClose} heightPercent={85}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <View padded paddingTop="$s4" paddingBottom={0} flex={1} gap="$s4_5">
          <Text fontSize={15} fontWeight="bold" textAlign="center">
            {displayLabel}
          </Text>
          <XStack
            borderColor="$uiNeutralTertiary"
            width="100%"
            borderWidth={1}
            borderRadius="$r3"
            backgroundColor="$backgroundSoft"
            overflow="hidden"
            alignItems="center"
          >
            <XStack alignItems="center" gap="$s2" flex={1} paddingHorizontal="$s3">
              <Search size={18} color="$uiNeutralSecondary" />
              <Input
                placeholder={t("Search tokens")}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholderTextColor="$uiNeutralPlaceholder"
                autoCapitalize="none"
                flex={1}
                borderWidth={0}
                borderColor="transparent"
                backgroundColor="transparent"
                padding={0}
                minHeight={44}
                color="$uiNeutralPrimary"
                focusStyle={{ borderColor: "transparent", backgroundColor: "transparent" }}
                focusVisibleStyle={{ outlineWidth: 0, borderColor: "transparent", outlineColor: "transparent" }}
              />
            </XStack>
          </XStack>
          <ScrollView flex={1} showsVerticalScrollIndicator={false}>
            <YStack paddingBottom="$s6" gap="$s4">
              {filteredGroups.map((group) => (
                <YStack key={group.chain.id} gap="$s4">
                  <XStack alignItems="center" paddingHorizontal="$s3">
                    <Text footnote color="$uiNeutralPlaceholder">
                      {group.chain.name}
                    </Text>
                  </XStack>
                  <YStack gap="$s3">
                    {group.assets.map(({ token, balance, usdValue }) => {
                      const isSelected = selected?.chain === group.chain.id && selected.address === token.address;
                      return (
                        <Pressable
                          key={`${group.chain.id}:${token.address}`}
                          onPress={() => {
                            onSelect(group.chain.id, token);
                            handleClose();
                          }}
                        >
                          <XStack
                            padding="$s3_5"
                            alignItems="center"
                            justifyContent="space-between"
                            borderRadius="$r3"
                            backgroundColor={isSelected ? "$interactiveBaseBrandSoftDefault" : "transparent"}
                            gap="$s3_5"
                          >
                            <XStack gap="$s3_5" alignItems="center" flex={1}>
                              <AssetLogo symbol={token.symbol} uri={token.logoURI} width={36} height={36} />
                              <YStack flex={1}>
                                <Text emphasized subHeadline color="$uiNeutralPrimary">
                                  {token.symbol}
                                </Text>
                                <Text footnote color="$uiNeutralSecondary" numberOfLines={1}>
                                  {token.name}
                                </Text>
                              </YStack>
                            </XStack>
                            {!hideBalances && (
                              <YStack alignItems="flex-end" gap="$s1">
                                <Text callout color="$uiNeutralPrimary">
                                  {`$${usdValue.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                </Text>
                                <Text footnote color="$uiNeutralSecondary">
                                  {`${Number(formatUnits(balance, token.decimals)).toLocaleString(language, {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: Math.min(
                                      8,
                                      Math.max(
                                        0,
                                        token.decimals - Math.ceil(Math.log10(Math.max(1, Number(balance) / 1e18))),
                                      ),
                                    ),
                                    useGrouping: false,
                                  })} ${token.symbol}`}
                                </Text>
                              </YStack>
                            )}
                          </XStack>
                        </Pressable>
                      );
                    })}
                  </YStack>
                </YStack>
              ))}
              {filteredGroups.length === 0 && (
                <View alignItems="center" paddingVertical="$s8">
                  <Text footnote color="$uiNeutralSecondary">
                    {searchQuery
                      ? t("No assets match your filters.")
                      : t("No assets with balance available to bridge.")}
                  </Text>
                </View>
              )}
            </YStack>
          </ScrollView>
        </View>
      </SafeView>
    </ModalSheet>
  );
}
