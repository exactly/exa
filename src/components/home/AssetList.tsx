import React from "react";
import { useTranslation } from "react-i18next";

import { useQueries } from "@tanstack/react-query";

import chain, { chains } from "@exactly/common/generated/chain";
import { floatingDepositRates, WAD } from "@exactly/lib";

import AssetSection from "./AssetSection";
import MarketRow from "./MarketRow";
import networkOptions from "../../utils/networkOptions";
import useAccount from "../../utils/useAccount";
import Rate from "../shared/Rate";

export default function AssetList({ titled = false }: { titled?: boolean }) {
  const { t } = useTranslation();
  const { address: account } = useAccount();
  const previews = useQueries({ queries: ids.map((chainId) => networkOptions(account, chainId)) });
  const rows = ids
    .flatMap((chainId, index) => {
      const data = previews[index]?.data;
      if (!data?.markets) return [];
      const rates = data.snapshot ? floatingDepositRates(data.snapshot, Number(data.timestamp)) : [];
      return data.markets.map((market) => ({
        ...market,
        chainId,
        rate: rates.find(({ market: address }) => address === market.market)?.rate,
        symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
        usdValue: Number((market.floatingDepositAssets * market.usdPrice) / BigInt(10 ** market.decimals)) / 1e18,
      }));
    })
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

const ids = chains.has(chain.id) ? [chain.id, ...[...chains.keys()].filter((id) => id !== chain.id)] : [chain.id];
