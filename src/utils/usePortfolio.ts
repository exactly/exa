import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { previewerAddress, ratePreviewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly, useReadRatePreviewerSnapshot } from "@exactly/common/generated/hooks";
import { floatingDepositRates, withdrawLimit } from "@exactly/lib";

import { tokenBalancesOptions } from "./lifi";
import useAccount from "./useAccount";

import type { Hex } from "@exactly/common/validation";

export type ProtocolAsset = {
  asset: Hex;
  assetName: string;
  decimals: number;
  floatingDepositAssets: bigint;
  market: Hex;
  symbol: string;
  type: "protocol";
  usdPrice: bigint;
  usdValue: number;
};

export type ExternalAsset = {
  address: string;
  amount?: bigint;
  decimals: number;
  logoURI?: string;
  name: string;
  priceUSD: string;
  symbol: string;
  type: "external";
  usdValue: number;
};

export type PortfolioAsset = ExternalAsset | ProtocolAsset;

export default function usePortfolio(options?: { sortBy?: "usdcFirst" | "usdValue" }) {
  const { address: account } = useAccount();

  const { data: rateSnapshot, dataUpdatedAt: rateDataUpdatedAt } = useReadRatePreviewerSnapshot({
    address: ratePreviewerAddress,
  });
  const { data: markets, isPending: isMarketsPending } = useReadPreviewerExactly({
    address: previewerAddress,
    args: account ? [account] : undefined,
    query: { enabled: !!account },
  });

  const { data: tokenBalances, isPending: isExternalPending } = useQuery(tokenBalancesOptions(account));

  const portfolio = useMemo(() => {
    if (!markets) return { depositMarkets: [], balanceUSD: 0n };

    const depositMarkets: { market: string; symbol: string; usdValue: bigint }[] = [];
    let balanceUSD = 0n;
    for (const { floatingDepositAssets, usdPrice, decimals, market, symbol } of markets) {
      if (floatingDepositAssets <= 0n) continue;
      const usdValue = (floatingDepositAssets * usdPrice) / 10n ** BigInt(decimals);
      if (usdValue <= 0n) continue;
      depositMarkets.push({ market, symbol: symbol.slice(3) === "WETH" ? "ETH" : symbol.slice(3), usdValue });
      balanceUSD += usdValue;
    }

    return { balanceUSD, depositMarkets } as const;
  }, [markets]);

  const rates = useMemo(
    () => (rateSnapshot ? floatingDepositRates(rateSnapshot, Math.floor(rateDataUpdatedAt / 1000)) : []),
    [rateSnapshot, rateDataUpdatedAt],
  );

  const averageRate = useMemo(() => {
    const { depositMarkets, balanceUSD } = portfolio;
    if (depositMarkets.length === 0 || balanceUSD === 0n || rates.length === 0) return 0n;
    const rateByMarket = new Map(rates.map(({ market, rate }) => [market, rate]));

    let weightedRate = 0n;
    for (const { market, usdValue } of depositMarkets) {
      const rate = rateByMarket.get(market);
      if (rate === undefined || usdValue <= 0n) continue;
      weightedRate += rate * usdValue;
    }

    return weightedRate / balanceUSD;
  }, [portfolio, rates]);

  const protocolAssets = useMemo<ProtocolAsset[]>(() => {
    if (!markets) return [];
    return markets
      .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n)
      .map((market) => ({
        ...market,
        symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
        usdValue:
          Number((withdrawLimit(markets, market.market) * market.usdPrice) / BigInt(10 ** market.decimals)) / 1e18,
        type: "protocol" as const,
      }));
  }, [markets]);

  const externalAssets = useMemo<ExternalAsset[]>(() => {
    const balances = tokenBalances ?? [];
    if (balances.length === 0) return [];

    const marketAddresses = new Set(markets?.map(({ market }) => market.toLowerCase()));
    return balances
      .filter(({ address }) => !marketAddresses.has(address.toLowerCase()))
      .map((token) => ({
        ...token,
        usdValue: (Number(token.priceUSD) * Number(token.amount ?? 0n)) / 10 ** token.decimals,
        type: "external" as const,
      }));
  }, [tokenBalances, markets]);

  const assets = useMemo<PortfolioAsset[]>(() => {
    const combined = [...protocolAssets, ...externalAssets];
    return combined.sort((a, b) => {
      if (options?.sortBy === "usdcFirst") {
        const aSymbol = a.symbol;
        const bSymbol = b.symbol;
        if (aSymbol === "USDC" && bSymbol !== "USDC") return -1;
        if (bSymbol === "USDC" && aSymbol !== "USDC") return 1;
      }
      return b.usdValue - a.usdValue;
    });
  }, [protocolAssets, externalAssets, options?.sortBy]);

  const totalBalanceUSD = useMemo(() => {
    const externalUSD = externalAssets.reduce((sum, asset) => sum + asset.usdValue, 0);
    return portfolio.balanceUSD + BigInt(Math.round(externalUSD * 1e18));
  }, [portfolio.balanceUSD, externalAssets]);

  return {
    portfolio,
    averageRate,
    assets,
    protocolAssets,
    externalAssets,
    totalBalanceUSD,
    markets,
    isPending: isExternalPending || isMarketsPending,
  };
}
