import React from "react";
import { useTranslation } from "react-i18next";

import { WAD } from "@exactly/lib";

import AssetSection from "./AssetSection";
import MarketRow from "./MarketRow";
import { useNetworkMarkets } from "../../utils/useDeposits";
import Rate from "../shared/Rate";

export default function AssetList({ titled = false }: { titled?: boolean }) {
  const { t } = useTranslation();
  const { markets, rates } = useNetworkMarkets();
  const rows = [...markets]
    .flatMap(([chainId, network = []]) =>
      network.map((market) => ({
        ...market,
        chainId,
        rate: rates.get(chainId)?.find(({ market: address }) => address === market.market)?.rate,
        symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
        usdValue: Number((market.floatingDepositAssets * market.usdPrice) / BigInt(10 ** market.decimals)) / 1e18,
      })),
    )
    .filter(
      (market) =>
        !market.nonCollateral &&
        (market.floatingDepositAssets > 0n || (!market.isFrozen && market.reserveFactor < WAD)),
    );

  if (rows.length === 0) return null;

  return (
    <AssetSection
      title={titled ? t("Collateral assets") : undefined}
      description={t(
        "Used for payments with your Exa Card. They serve as collateral, earn yield and increase your credit limit.",
      )}
    >
      {rows
        .sort((a, b) => b.usdValue - a.usdValue)
        .map((market) => (
          <MarketRow
            key={`${market.chainId}:${market.market}`}
            asset={market.asset}
            chainId={market.chainId}
            decimals={market.decimals}
            floatingDepositAssets={market.floatingDepositAssets}
            market={market.market}
            symbol={market.symbol}
            value={market.usdValue}
          >
            {market.rate ? <Rate compact rate={market.rate} /> : null}
          </MarketRow>
        ))}
    </AssetSection>
  );
}
