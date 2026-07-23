import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, CircleHelp, Info, Search } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain, { allowlists } from "@exactly/common/generated/chain";

import AddFundsOption from "./AddFundsOption";
import CollateralSheet from "./CollateralSheet";
import OtherAssetsSheet from "./OtherAssetsSheet";
import { presentArticle } from "../../utils/intercom";
import { lifiTokensOptions, tokenCorrelation } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import useMarkets from "../../utils/useMarkets";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Assets() {
  const router = useRouter();
  const { t } = useTranslation();
  const { markets, supportedAssets, isPending } = useMarkets();
  const { data: tokens } = useQuery(lifiTokensOptions);
  const [collateralShown, setCollateralShown] = useState(false);
  const [otherShown, setOtherShown] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const assets = useMemo(() => {
    if (!markets) return [];
    const excluded = new Set(["USDC.e", "DAI"]);
    return markets
      .filter((market) => !excluded.has(market.symbol.slice(3)))
      .map((market) =>
        market.symbol.slice(3) === "WETH"
          ? { symbol: "ETH", name: "Ether" }
          : { symbol: market.symbol.slice(3), name: market.assetName },
      );
  }, [markets]);
  const others = useMemo(() => {
    if (!tokens || !markets) return [];
    const underlying = new Set(markets.map((market) => market.asset.toLowerCase()));
    const excluded = new Set(supportedAssets);
    const bySymbol = new Map<string, (typeof tokens)[number]>();
    for (const home of [true, false]) {
      for (const token of tokens) {
        if ((token.chainId === (chain.id as (typeof token)["chainId"])) !== home) continue;
        const allowed = allowlists[String(token.chainId)];
        if (!allowed?.some((address) => address.toLowerCase() === token.address.toLowerCase())) continue;
        if (home && underlying.has(token.address.toLowerCase())) continue;
        const correlated =
          token.symbol in tokenCorrelation
            ? tokenCorrelation[token.symbol as keyof typeof tokenCorrelation]
            : undefined;
        if (excluded.has(token.symbol) || (correlated && excluded.has(correlated))) continue;
        if (!bySymbol.has(token.symbol)) bySymbol.set(token.symbol, token);
      }
    }
    return [...bySymbol.values()];
  }, [tokens, markets, supportedAssets]);
  const visibleOthers = expanded ? others : others.slice(0, 3);
  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s6" fullScreen padded>
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
            {t("Cryptocurrencies")}
          </Text>
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("8950801").catch(reportError);
            }}
          />
        </XStack>
        <ScrollView flex={1} showsVerticalScrollIndicator={false}>
          <YStack gap="$s7">
            <YStack gap="$s4">
              <XStack gap="$s2" alignItems="center">
                <Text emphasized primary headline>
                  {t("Supported assets")}
                </Text>
                <Pressable hitSlop={15} onPress={() => setCollateralShown(true)}>
                  <Info size={16} color="$uiBrandSecondary" />
                </Pressable>
              </XStack>
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
                <XStack gap="$s2" alignItems="center">
                  <Text emphasized primary headline>
                    {t("Other assets")}
                  </Text>
                  <Pressable hitSlop={15} onPress={() => setOtherShown(true)}>
                    <Info size={16} color="$uiBrandSecondary" />
                  </Pressable>
                </XStack>
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
                  {!expanded && others.length > 3 && (
                    <AddFundsOption
                      icon={<Search size={24} color="$iconBrandDefault" />}
                      title={t("More assets")}
                      onPress={() => setExpanded(true)}
                    />
                  )}
                </YStack>
              </YStack>
            )}
          </YStack>
        </ScrollView>
        <CollateralSheet
          open={collateralShown}
          onClose={() => {
            setCollateralShown(false);
          }}
        />
        <OtherAssetsSheet
          open={otherShown}
          onClose={() => {
            setOtherShown(false);
          }}
        />
      </View>
    </SafeView>
  );
}
