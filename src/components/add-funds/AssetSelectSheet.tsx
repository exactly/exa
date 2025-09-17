import type { Chain, Token } from "@lifi/sdk";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";
import { formatUnits } from "viem";

import ChainLogo from "./ChainLogo";
import TokenLogo from "./TokenLogo";
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
}) {
  return (
    <ModalSheet open={open} onClose={onClose} heightPercent={85}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <View padded paddingTop="$s4" flex={1} gap="$s4">
          <Text fontSize={20} fontWeight="bold" textAlign="center">
            Choose asset
          </Text>
          <ScrollView flex={1} showsVerticalScrollIndicator={false}>
            <YStack paddingBottom="$s6" gap="$s4">
              {groups.map((group) => (
                <YStack key={group.chain.id} gap="$s4">
                  <XStack alignItems="center" gap="$s3_5" paddingHorizontal="$s3">
                    <ChainLogo chainData={group.chain} size={28} />
                    <Text emphasized callout color="$uiNeutralPrimary">
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
                            padding="$s4_5"
                            alignItems="center"
                            justifyContent="space-between"
                            borderRadius="$r3"
                            borderWidth={1}
                            borderColor={isSelected ? "$borderBrandStrong" : "$borderNeutralSoft"}
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
              {groups.length === 0 && (
                <View alignItems="center" paddingVertical="$s8">
                  <Text footnote color="$uiNeutralSecondary">
                    No assets with balance available to bridge.
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
