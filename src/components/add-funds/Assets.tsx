import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowLeft } from "@tamagui/lucide-icons-2/icons/ArrowLeft";
import { CircleHelp } from "@tamagui/lucide-icons-2/icons/CircleHelp";
import { Search } from "@tamagui/lucide-icons-2/icons/Search";
import { getTokens, ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain, { allowlists } from "@exactly/common/generated/chain";

import AddFundsOption from "./AddFundsOption";
import { presentArticle } from "../../utils/intercom";
import { lifiTokensOptions, tokenCorrelation } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import useInsets from "../../utils/useInsets";
import useMarkets from "../../utils/useMarkets";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";
import TokenSelectModal from "../swaps/SelectorModal";

import type { CardDetails } from "../../utils/server";

export default function Assets() {
  const router = useRouter();
  const insets = useInsets();
  const { t } = useTranslation();
  const { markets, supportedAssets, isPending } = useMarkets();
  const { data: tokens } = useQuery(lifiTokensOptions);
  const { data: card } = useQuery<CardDetails>({ queryKey: ["card", "details"] });
  const [moreShown, setMoreShown] = useState(false);
  const assets = useMemo(() => {
    if (!markets) return [];
    const available = markets
      .filter((market) => !market.isFrozen && !market.nonCollateral && market.symbol.slice(3) !== "DAI")
      .map((market) =>
        market.symbol.slice(3) === "WETH"
          ? { symbol: "ETH", name: "Ether" }
          : { symbol: market.symbol.slice(3), name: market.assetName },
      );
    const pinned = ["USDC", "ETH", "WBTC", "wstETH", "OP"];
    return [
      ...pinned.flatMap((symbol) => available.find((asset) => asset.symbol === symbol) ?? []),
      ...available.filter((asset) => !pinned.includes(asset.symbol)),
    ];
  }, [markets]);
  const others = useMemo(() => {
    if (!tokens || !markets) return [];
    const underlying = new Set(
      markets.filter(({ nonCollateral }) => !nonCollateral).map((market) => market.asset.toLowerCase()),
    );
    const excluded = new Set(supportedAssets);
    const bySymbol = new Map<string, (typeof tokens)[number]>();
    for (const token of tokens) {
      const home = token.chainId === (chain.id as (typeof token)["chainId"]);
      const allowed = allowlists[String(token.chainId)];
      if (!allowed?.some((address) => address.toLowerCase() === token.address.toLowerCase())) continue;
      if (home && underlying.has(token.address.toLowerCase())) continue;
      const correlated =
        token.symbol in tokenCorrelation ? tokenCorrelation[token.symbol as keyof typeof tokenCorrelation] : undefined;
      if (excluded.has(token.symbol) || (correlated && excluded.has(correlated))) continue;
      const current = bySymbol.get(token.symbol);
      if (!current || (home && current.chainId !== token.chainId)) bySymbol.set(token.symbol, token);
    }
    return [...bySymbol.values()];
  }, [tokens, markets, supportedAssets]);
  const visibleOthers = others.slice(0, 4);
  return (
    <SafeView fullScreen backgroundColor="$backgroundMild" paddingBottom={0}>
      <View gap="$s6" fullScreen padded paddingBottom={0}>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/add-funds");
              }
            }}
          />
          <Text emphasized subHeadline primary>
            {t("Digital assets")}
          </Text>
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("8950801").catch(reportError);
            }}
          />
        </XStack>
        <ScrollView
          flex={1}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + getTokens().space.$s4.val }}
        >
          <YStack gap="$s7">
            <YStack gap="$s4">
              <YStack gap="$s2">
                <Text emphasized primary headline>
                  {t("Collateral assets")}
                </Text>
                <Text footnote secondary>
                  {t(
                    card === null
                      ? "To activate your Exa Card, you need one of these assets on {{chain}}."
                      : "Assets on {{chain}} that can be used with your Exa Card. They serve as collateral, earn yield and increase your credit limit.",
                    { chain: chain.name },
                  )}
                </Text>
              </YStack>
              <YStack gap="$s3_5">
                {isPending
                  ? Array.from({ length: 5 }, (_, index) => <Skeleton key={index} width="100%" height={82} />)
                  : assets.map(({ symbol, name }) => (
                      <AddFundsOption
                        key={symbol}
                        icon={<AssetLogo symbol={symbol} width={24} height={24} />}
                        title={symbol}
                        subtitle={name}
                        onPress={() => {
                          router.push({ pathname: "/add-funds/network", params: { asset: symbol } });
                        }}
                      />
                    ))}
              </YStack>
            </YStack>
            {others.length > 0 && (
              <YStack gap="$s4">
                <YStack gap="$s2">
                  <Text emphasized primary headline>
                    {t("Other assets")}
                  </Text>
                  <Text footnote secondary>
                    {t(
                      card === null
                        ? "These won’t activate your Exa Card. Once they arrive, swap or bridge them in-app to a collateral asset above."
                        : "Assets that can’t be used with your Exa Card. Once they arrive, swap or bridge them in-app to a collateral asset above.",
                    )}
                  </Text>
                </YStack>
                <YStack gap="$s3_5">
                  {visibleOthers.map((token) => (
                    <AddFundsOption
                      key={token.address}
                      icon={<AssetLogo symbol={token.symbol} uri={token.logoURI} width={24} height={24} />}
                      title={token.symbol}
                      subtitle={token.name}
                      onPress={() => {
                        router.push({ pathname: "/add-funds/network", params: { asset: token.symbol } });
                      }}
                    />
                  ))}
                  {others.length > 4 && (
                    <AddFundsOption
                      icon={<Search size={24} color="$iconBrandDefault" />}
                      title={t("More assets")}
                      onPress={() => setMoreShown(true)}
                    />
                  )}
                </YStack>
              </YStack>
            )}
          </YStack>
        </ScrollView>
        <TokenSelectModal
          open={moreShown}
          tokens={others}
          title={t("Select asset")}
          onSelect={(token) => {
            setMoreShown(false);
            router.push({ pathname: "/add-funds/network", params: { asset: token.symbol } });
          }}
          onClose={() => setMoreShown(false)}
        />
      </View>
    </SafeView>
  );
}
