import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Search } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";
import { withdrawLimit } from "@exactly/lib";

import NetworkFilter from "./NetworkFilter";
import { lifiChainsOptions } from "../../utils/lifi";
import usePortfolio from "../../utils/usePortfolio";
import AssetLogo from "../shared/AssetLogo";
import Input from "../shared/Input";
import ModalSheet from "../shared/ModalSheet";
import Text from "../shared/Text";

import type { PortfolioAsset } from "../../utils/usePortfolio";

export default function PaySheet({
  open,
  onClose,
  onSelect,
  assets,
}: {
  assets: PortfolioAsset[];
  onClose: () => void;
  onSelect: (address: string, chainId: number) => void;
  open: boolean;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [query, setQuery] = useState("");
  const [network, setNetwork] = useState<number>();
  const { markets } = usePortfolio();
  const { data: chains } = useQuery(lifiChainsOptions);
  const networks = useMemo(() => {
    const ids = [
      ...new Set(
        assets.flatMap((asset) => (asset.usdValue > 0 ? [asset.type === "external" ? asset.chainId : chain.id] : [])),
      ),
    ];
    return ids
      .map((id) => ({ id, name: chains?.find((item) => item.id === id)?.name ?? chain.name }))
      .sort((a, b) => {
        if (a.id === chain.id) return -1;
        if (b.id === chain.id) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [assets, chains]);
  const groups = useMemo(() => {
    const search = query.trim().toLowerCase();
    const matches = assets.filter(
      (asset) =>
        asset.usdValue > 0 &&
        (!search || asset.symbol.toLowerCase().includes(search)) &&
        (network === undefined || (asset.type === "external" ? asset.chainId : chain.id) === network),
    );
    const ids = [...new Set(matches.map((asset) => (asset.type === "external" ? asset.chainId : chain.id)))].sort(
      (a, b) => {
        if (a === chain.id) return -1;
        if (b === chain.id) return 1;
        return a - b;
      },
    );
    return ids.map((id) => ({
      id,
      assets: matches.filter((asset) => (asset.type === "external" ? asset.chainId : chain.id) === id),
    }));
  }, [assets, query, network]);
  function close() {
    setQuery("");
    setNetwork(undefined);
    onClose();
  }
  return (
    <ModalSheet open={open} onClose={close}>
      <YStack
        gap="$s4_5"
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        paddingTop="$s7"
        paddingHorizontal="$s4"
        paddingBottom="$s7"
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <Text emphasized subHeadline primary textAlign="center">
          {t("Select asset to pay with")}
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
            placeholder={t("Search assets")}
            placeholderTextColor="$uiNeutralPlaceholder"
            value={query}
            onChangeText={setQuery}
          />
          <NetworkFilter chains={networks} value={network} onChange={setNetwork} />
        </XStack>
        <ScrollView maxHeight={400} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <YStack gap="$s6" paddingVertical="$s4_5">
            {groups.map((group) => (
              <YStack key={group.id} gap="$s5">
                <Text subHeadline color="$uiNeutralPlaceholder">
                  {chains?.find((item) => item.id === group.id)?.name ?? chain.name}
                </Text>
                {group.assets.map((asset) => {
                  const available =
                    asset.type === "external"
                      ? (asset.amount ?? 0n)
                      : markets
                        ? withdrawLimit(markets, asset.market)
                        : 0n;
                  const usdPrice = asset.type === "external" ? Number(asset.priceUSD) : Number(asset.usdPrice) / 1e18;
                  const name =
                    asset.type === "external"
                      ? asset.name
                      : asset.assetName === "Wrapped Ether"
                        ? "Ether"
                        : asset.assetName;
                  return (
                    <XStack
                      key={asset.type === "external" ? `${asset.chainId}:${asset.address}` : asset.market}
                      gap="$s3"
                      alignItems="center"
                      cursor="pointer"
                      pressStyle={{ opacity: 0.7 }}
                      onPress={() => {
                        onSelect(asset.type === "external" ? asset.address : asset.market, group.id);
                        close();
                      }}
                    >
                      <AssetLogo
                        uri={asset.type === "external" ? asset.logoURI : undefined}
                        symbol={asset.symbol}
                        width={40}
                        height={40}
                        chainId={group.id}
                        network
                      />
                      <YStack gap="$s2" flex={1}>
                        <Text emphasized callout primary numberOfLines={1}>
                          {asset.symbol}
                        </Text>
                        <Text footnote secondary numberOfLines={1}>
                          {name}
                        </Text>
                      </YStack>
                      <YStack gap="$s2" alignItems="flex-end">
                        <Text emphasized callout primary>
                          {`$${asset.usdValue.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </Text>
                        <Text caption secondary>
                          {(Number(available) / 10 ** asset.decimals).toLocaleString(language, {
                            maximumFractionDigits: Math.min(
                              8,
                              Math.max(0, asset.decimals - Math.ceil(Math.log10(Math.max(1, usdPrice)))),
                            ),
                          })}
                        </Text>
                      </YStack>
                    </XStack>
                  );
                })}
              </YStack>
            ))}
            {groups.length === 0 && (
              <Text textAlign="center" footnote color="$uiNeutralSecondary">
                {t("No available assets.")}
              </Text>
            )}
          </YStack>
        </ScrollView>
      </YStack>
    </ModalSheet>
  );
}
