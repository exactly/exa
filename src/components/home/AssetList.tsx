import React from "react";
import { useTranslation } from "react-i18next";
import { vs } from "react-native-size-matters";

import { XStack, YStack } from "tamagui";

import { parseUnits, zeroAddress } from "viem";

import { previewerAddress, ratePreviewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly, useReadRatePreviewerSnapshot } from "@exactly/common/generated/hooks";
import { floatingDepositRates } from "@exactly/lib";

import assetLogos from "../../utils/assetLogos";
import useAccount from "../../utils/useAccount";
import useAccountAssets from "../../utils/useAccountAssets";
import AssetLogo from "../shared/AssetLogo";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";

type AssetItem = {
  amount: bigint;
  assetName?: string;
  decimals: number;
  logoURI?: string;
  market?: string;
  rate?: bigint;
  symbol: string;
  usdPrice: bigint;
  usdValue: bigint;
};

function AssetRow({ asset }: { asset: AssetItem }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { symbol, logoURI, amount, decimals, usdPrice, usdValue, rate } = asset;
  return (
    <XStack alignItems="center" borderColor="$borderNeutralSoft" paddingVertical={vs(10)} gap="$s2" width="100%">
      <XStack gap={10} alignItems="center" flex={1} $platform-web={{ flexBasis: 1 / 3 }}>
        <AssetLogo height={32} source={{ uri: logoURI ?? assetLogos[symbol as keyof typeof assetLogos] }} width={32} />
        <YStack gap="$s2" alignItems="flex-start">
          <Text subHeadline color="$uiNeutralPrimary" numberOfLines={1}>
            {symbol}
          </Text>
          <Text caption color="$uiNeutralSecondary" numberOfLines={1}>
            {`$${(Number(usdPrice) / 1e18).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </Text>
        </YStack>
      </XStack>
      <YStack gap={5} flex={1} alignItems="flex-end" $platform-web={{ flexBasis: 1 / 3 }}>
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
      <YStack gap={5} flex={1} $platform-web={{ flexBasis: 1 / 3 }}>
        <Text sensitive emphasized subHeadline numberOfLines={1} adjustsFontSizeToFit textAlign="right">
          {`$${(Number(usdValue) / 1e18).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </Text>
        <Text caption color="$uiNeutralSecondary" textAlign="right">
          {(Number(amount) / 10 ** decimals).toLocaleString(language, {
            minimumFractionDigits: 1,
            maximumFractionDigits: Math.min(
              8,
              Math.max(0, decimals - Math.ceil(Math.log10(Math.max(1, Number(usdValue) / 1e18)))),
            ),
          })}
        </Text>
      </YStack>
    </XStack>
  );
}

function AssetSection({ title, assets }: { assets: AssetItem[]; title: string }) {
  if (assets.length === 0) return null;
  return (
    <YStack backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s2_5">
      <Text emphasized headline color="$uiNeutralPrimary">
        {title}
      </Text>
      {assets.map((asset) => (
        <AssetRow key={asset.symbol} asset={asset} />
      ))}
    </YStack>
  );
}

export default function AssetList() {
  const { t } = useTranslation();
  const { address } = useAccount();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });
  const { externalAssets } = useAccountAssets();
  const { data: snapshots, dataUpdatedAt } = useReadRatePreviewerSnapshot({
    address: ratePreviewerAddress,
  });

  const rates = snapshots ? floatingDepositRates(snapshots, Math.floor(dataUpdatedAt / 1000)) : [];

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

  const externalAssetItems = externalAssets.map(({ symbol, name, logoURI, amount, decimals, usdValue, priceUSD }) => ({
    symbol,
    name,
    logoURI,
    amount: amount ?? 0n,
    decimals,
    usdValue: parseUnits(usdValue.toFixed(18), 18),
    usdPrice: parseUnits(priceUSD, 18),
  }));

  return (
    <YStack gap="$s4">
      <AssetSection title={t("Collateral Assets")} assets={collateralAssets} />
      <AssetSection title={t("Other Assets")} assets={externalAssetItems} />
    </YStack>
  );
}
