import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import { Info } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";
import { floatingDepositRates } from "@exactly/lib";

import CollateralAssetsSheet from "./CollateralAssetsSheet";
import reportError from "../../utils/reportError";
import useMarkets from "../../utils/useMarkets";
import AssetLogo from "../shared/AssetLogo";
import ChainLogo from "../shared/ChainLogo";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Address } from "@exactly/common/validation";

export default function AssetList() {
  const { t } = useTranslation();
  const router = useRouter();
  const { markets, rateSnapshot, timestamp } = useMarkets();
  const [sheetOpen, setSheetOpen] = useState(false);

  const rates = rateSnapshot ? floatingDepositRates(rateSnapshot, Number(timestamp)) : [];

  const collateralAssets =
    markets
      ?.map((market) => {
        const symbol = market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3);
        const rate = rates.find((r: { market: string; rate: bigint }) => r.market === market.market)?.rate;
        return {
          symbol,
          name: symbol,
          assetName: market.assetName === "Wrapped Ether" ? "Ether" : market.assetName,
          market: market.market,
          amount: market.floatingDepositAssets,
          decimals: market.decimals,
          usdPrice: market.usdPrice,
          usdValue: (market.floatingDepositAssets * market.usdPrice) / BigInt(10 ** market.decimals),
          rate,
        };
      })
      .filter(({ amount, symbol }) => (symbol === "USDC.e" ? amount > 0n : true))
      .sort((a, b) => Number(b.usdValue) - Number(a.usdValue)) ?? [];

  return (
    <>
      <AssetSection
        title={t("Collateral assets")}
        assets={collateralAssets}
        onInfoPress={() => {
          setSheetOpen(true);
        }}
        onSelect={(asset) => {
          if (!asset.market) return;
          selectionAsync().catch(reportError);
          router.push({ pathname: "/send-funds", params: { asset: asset.market as Address } });
        }}
      />
      <CollateralAssetsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}

type AssetItem = {
  amount: bigint;
  assetName?: string;
  decimals: number;
  market?: string;
  rate?: bigint;
  symbol: string;
  usdPrice: bigint;
  usdValue: bigint;
};

function AssetRow({ asset, onPress }: { asset: AssetItem; onPress?: () => void }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { symbol, amount, decimals, usdValue, usdPrice, rate } = asset;
  const digits = Math.min(8, Math.max(0, decimals - Math.ceil(Math.log10(Math.max(1, Number(usdValue) / 1e18)))));
  return (
    <XStack
      alignItems="center"
      borderColor="$borderNeutralSoft"
      paddingVertical="$s3_5"
      gap="$s2"
      width="100%"
      cursor={onPress ? "pointer" : "default"}
      pressStyle={onPress ? { opacity: 0.7 } : undefined}
      onPress={onPress}
    >
      <XStack gap="$s3_5" alignItems="center" flex={1}>
        <View position="relative">
          <AssetLogo height={32} symbol={symbol} width={32} />
          <View position="absolute" bottom={-4} right={-4}>
            <ChainLogo chainId={chain.id} size={16} borderRadius="$r_0" />
          </View>
        </View>
        <YStack gap="$s2" alignItems="flex-start">
          <Text subHeadline color="$uiNeutralPrimary" numberOfLines={1}>
            {symbol}
          </Text>
          <Text caption color="$uiNeutralSecondary" numberOfLines={1}>
            {`$${(Number(usdPrice) / 1e18).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </Text>
        </YStack>
      </XStack>
      <YStack gap="$s2" flex={1} alignItems="flex-end">
        {rate === undefined ? (
          asset.market ? (
            <>
              <Skeleton height={15} width={50} />
              <Skeleton height={12} width={50} />
            </>
          ) : (
            <Text caption textAlign="right" color="transparent">
              -
            </Text>
          )
        ) : (
          <>
            <Text subHeadline emphasized textAlign="right" color="$interactiveTextSuccessDefault">
              {(Number(rate) / 1e18).toLocaleString(language, {
                style: "percent",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
            <Text caption color="$uiNeutralSecondary" textAlign="right">
              {t("Yield")}
            </Text>
          </>
        )}
      </YStack>
      <YStack gap="$s2" flex={1}>
        <Text sensitive emphasized subHeadline numberOfLines={1} adjustsFontSizeToFit textAlign="right">
          {`$${(Number(usdValue) / 1e18).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </Text>
        <Text caption color="$uiNeutralSecondary" textAlign="right">
          {(Number(amount) / 10 ** decimals).toLocaleString(language, {
            minimumFractionDigits: Math.min(1, digits),
            maximumFractionDigits: digits,
          })}
        </Text>
      </YStack>
    </XStack>
  );
}

function AssetSection({
  title,
  assets,
  onSelect,
  onInfoPress,
}: {
  assets: AssetItem[];
  onInfoPress?: () => void;
  onSelect?: (asset: AssetItem) => void;
  title: string;
}) {
  if (assets.length === 0) return null;
  return (
    <YStack backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s3">
      <XStack alignItems="center" gap="$s2" onPress={onInfoPress}>
        <Text emphasized headline color="$uiNeutralPrimary">
          {title}
        </Text>
        {onInfoPress ? <Info size={16} color="$interactiveOnBaseBrandSoft" /> : null}
      </XStack>
      {assets.map((asset) => (
        <AssetRow
          key={asset.symbol}
          asset={asset}
          onPress={onSelect && asset.amount > 0n ? () => onSelect(asset) : undefined}
        />
      ))}
    </YStack>
  );
}
