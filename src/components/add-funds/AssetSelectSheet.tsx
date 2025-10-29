import type { Chain, Token } from "@lifi/sdk";
import { ChevronDown, Search } from "@tamagui/lucide-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, type LayoutChangeEvent } from "react-native";
import { ScrollView, XStack, YStack, styled } from "tamagui";
import { formatUnits } from "viem";

import ChainLogo from "./ChainLogo";
import TokenLogo from "./TokenLogo";
import Input from "../shared/Input";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AssetSelectSheet({
  open,
  groups,
  selected,
  onSelect,
  onClose,
  hideBalances = false,
  enableNetworkFilter = false,
  label = "Select asset",
}: {
  open: boolean;
  groups: {
    chain: Pick<Chain, "id" | "name" | "logoURI">;
    assets: { token: Token; balance: bigint; usdValue: number }[];
  }[];
  selected?: { chain: number; address: string };
  onSelect: (chainId: number, token: Token) => void;
  onClose: () => void;
  hideBalances?: boolean;
  enableNetworkFilter?: boolean;
  label?: string;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedNetworkId, setSelectedNetworkId] = useState<number | undefined>();
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [searchWidth, setSearchWidth] = useState<number | undefined>();

  const handleSearchLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setSearchWidth((previous) => (previous === width ? previous : width));
  }, []);

  const availableNetworks = useMemo(
    () => groups.filter((group) => group.assets.length > 0).map((group) => group.chain),
    [groups],
  );

  const filteredGroups = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return groups
      .filter((group) => !enableNetworkFilter || !selectedNetworkId || group.chain.id === selectedNetworkId)
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
  }, [enableNetworkFilter, groups, searchQuery, selectedNetworkId]);

  const showNetworkFilter = enableNetworkFilter && availableNetworks.length > 0;

  const networkIcons = useMemo(() => {
    if (!showNetworkFilter) return [] as typeof availableNetworks;
    if (selectedNetworkId) {
      const selectedChain = availableNetworks.find((chain) => chain.id === selectedNetworkId);
      const remaining = availableNetworks.filter((chain) => chain.id !== selectedNetworkId);
      return [selectedChain, ...remaining].filter(Boolean).slice(0, 4) as typeof availableNetworks;
    }
    return availableNetworks.slice(0, 4);
  }, [availableNetworks, selectedNetworkId, showNetworkFilter]);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setNetworkDropdownOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!showNetworkFilter) {
      setNetworkDropdownOpen(false);
      setSelectedNetworkId(undefined);
    }
  }, [showNetworkFilter]);

  useEffect(() => {
    if (!enableNetworkFilter) return;
    if (selectedNetworkId && !groups.some((group) => group.chain.id === selectedNetworkId)) {
      setSelectedNetworkId(undefined);
    }
  }, [enableNetworkFilter, groups, selectedNetworkId]);

  return (
    <ModalSheet open={open} onClose={onClose} heightPercent={85}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <View padded paddingTop="$s4" paddingBottom={0} flex={1} gap="$s4_5">
          <Text fontSize={15} fontWeight="bold" textAlign="center">
            {label}
          </Text>
          <YStack gap="$s2">
            <View position="relative" width="100%" onLayout={handleSearchLayout}>
              <XStack
                borderColor="$uiNeutralTertiary"
                width="100%"
                borderWidth="1"
                borderRadius="$r3"
                backgroundColor="$backgroundSoft"
                overflow="hidden"
                alignItems="center"
              >
                <XStack alignItems="center" gap="$s2" flex={1} paddingHorizontal="$s3">
                  <Search size={18} color="$uiNeutralSecondary" />
                  <SearchInput
                    placeholder="Search tokens"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholderTextColor="$uiNeutralPlaceholder"
                    autoCapitalize="none"
                    autoCorrect={false}
                    flex={1}
                    borderWidth={0}
                    borderColor="transparent"
                    backgroundColor="transparent"
                    padding={0}
                    minHeight={44}
                    color="$uiNeutralPrimary"
                    fontSize={15}
                  />
                </XStack>
                {showNetworkFilter ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      setNetworkDropdownOpen((value) => !value);
                    }}
                  >
                    <XStack
                      alignItems="center"
                      gap="$s2"
                      paddingHorizontal="$s2_5"
                      paddingVertical="$s2"
                      borderLeftWidth={1}
                      borderLeftColor="$borderNeutralSoft"
                      backgroundColor="$backgroundSoft"
                      height="100%"
                    >
                      <XStack flexWrap="wrap" width={36} gap="$s1" justifyContent="flex-end">
                        {networkIcons.map((chain) => (
                          <ChainLogo key={chain.id} chainData={chain} size={12} />
                        ))}
                      </XStack>
                      <ChevronDown
                        size={16}
                        color="$uiNeutralSecondary"
                        style={{ transform: [{ rotate: networkDropdownOpen ? "180deg" : "0deg" }] }}
                      />
                    </XStack>
                  </Pressable>
                ) : null}
              </XStack>
              {showNetworkFilter && networkDropdownOpen ? (
                <YStack
                  width={searchWidth ?? undefined}
                  paddingHorizontal="$s3"
                  paddingVertical="$s3"
                  position="absolute"
                  top="100%"
                  right={0}
                  marginTop="$s2"
                  borderWidth={1}
                  borderColor="$borderNeutralSoft"
                  borderRadius="$r3"
                  overflow="hidden"
                  backgroundColor="$backgroundSoft"
                  zIndex={10}
                  elevation={12}
                >
                  <Pressable
                    onPress={() => {
                      setSelectedNetworkId(undefined);
                      setNetworkDropdownOpen(false);
                    }}
                  >
                    <View>
                      <XStack
                        gap="$s3"
                        alignItems="center"
                        padding="$s3"
                        backgroundColor={selectedNetworkId ? "transparent" : "$interactiveBaseBrandSoftDefault"}
                        borderRadius="$r2"
                      >
                        <XStack flexWrap="wrap" width={20} gap="$s1" justifyContent="flex-end">
                          {networkIcons.map((chain) => (
                            <ChainLogo key={chain.id} chainData={chain} size={8} />
                          ))}
                        </XStack>
                        <Text footnote color="$uiNeutralPrimary">
                          All networks
                        </Text>
                      </XStack>
                    </View>
                  </Pressable>
                  {availableNetworks.map((chain) => (
                    <Pressable
                      key={chain.id}
                      onPress={() => {
                        setSelectedNetworkId(chain.id);
                        setNetworkDropdownOpen(false);
                      }}
                    >
                      <View>
                        <XStack
                          gap="$s3"
                          alignItems="center"
                          padding="$s3"
                          backgroundColor={
                            selectedNetworkId === chain.id ? "$interactiveBaseBrandSoftDefault" : "transparent"
                          }
                          borderRadius="$r2"
                        >
                          <ChainLogo chainData={chain} size={20} />
                          <Text footnote color="$uiNeutralPrimary">
                            {chain.name}
                          </Text>
                        </XStack>
                      </View>
                    </Pressable>
                  ))}
                </YStack>
              ) : null}
            </View>
          </YStack>
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
                            onClose();
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
                              <TokenLogo token={token} />
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
                                  {usdValue.toLocaleString(undefined, {
                                    style: "currency",
                                    currency: "USD",
                                    currencyDisplay: "narrowSymbol",
                                  })}
                                </Text>
                                <Text footnote color="$uiNeutralSecondary">
                                  {`${Number(formatUnits(balance, token.decimals)).toLocaleString(undefined, {
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
                    {searchQuery || (showNetworkFilter && selectedNetworkId)
                      ? "No assets match your filters."
                      : "No assets with balance available to bridge."}
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

const SearchInput = styled(Input, {
  focusStyle: { borderColor: "transparent", backgroundColor: "transparent" },
  focusVisibleStyle: { outlineWidth: 0, borderColor: "transparent", outlineColor: "transparent" },
});
