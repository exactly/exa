import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";

import { previewerAddress, ratePreviewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly, useReadRatePreviewerSnapshot } from "@exactly/common/generated/hooks";
import { floatingDepositRates, withdrawLimit } from "@exactly/lib";

import { tokenBalancesOptions } from "./queryClient";
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
  name: string;
  priceUSD: string;
  symbol: string;
  type: "external";
  usdValue: number;
};

export type PortfolioAsset = ExternalAsset | ProtocolAsset;

export default function usePortfolio(account?: Hex, options?: { sortBy?: "usdcFirst" | "usdValue" }) {
  const { address: connectedAccount } = useAccount();
  const resolvedAccount = account ?? connectedAccount;

  const { data: rateSnapshot, dataUpdatedAt: rateDataUpdatedAt } = useReadRatePreviewerSnapshot({
    address: ratePreviewerAddress,
  });
  const { data: markets, isPending: isMarketsPending } = useReadPreviewerExactly({
    address: previewerAddress,
    args: [resolvedAccount ?? zeroAddress],
  });

  const { data: tokenBalances, isPending: isExternalPending } = useQuery(tokenBalancesOptions(resolvedAccount));

  const portfolio = useMemo(() => {
    if (!markets) return { depositMarkets: [], usdBalance: 0n };

    const depositMarkets: { market: string; symbol: string; usdValue: bigint }[] = [];
    let usdBalance = 0n;
    for (const { floatingDepositAssets, usdPrice, decimals, market, symbol } of markets) {
      if (floatingDepositAssets <= 0n) continue;
      const usdValue = (floatingDepositAssets * usdPrice) / 10n ** BigInt(decimals);
      if (usdValue <= 0n) continue;
      depositMarkets.push({ market, symbol: symbol.slice(3) === "WETH" ? "ETH" : symbol.slice(3), usdValue });
      usdBalance += usdValue;
    }

    return { usdBalance, depositMarkets } as const;
  }, [markets]);

  const rates = useMemo(
    () => (rateSnapshot ? floatingDepositRates(rateSnapshot, Math.floor(rateDataUpdatedAt / 1000)) : []),
    [rateSnapshot, rateDataUpdatedAt],
  );

  const averageRate = useMemo(() => {
    const { depositMarkets, usdBalance } = portfolio;
    if (depositMarkets.length === 0 || usdBalance === 0n || rates.length === 0) return 0n;
    const rateByMarket = new Map(rates.map(({ market, rate }) => [market, rate]));

    let weightedRate = 0n;
    for (const { market, usdValue } of depositMarkets) {
      const rate = rateByMarket.get(market);
      if (rate === undefined || usdValue <= 0n) continue;
      weightedRate += rate * usdValue;
    }

    return weightedRate / usdBalance;
  }, [portfolio, rates]);

  const protocolAssets = useMemo<ProtocolAsset[]>(() => {
    if (!markets) return [];
    return markets
      .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n)
      .map((market) => ({
        ...market,
        usdValue:
          Number((withdrawLimit(markets, market.market) * market.usdPrice) / BigInt(10 ** market.decimals)) / 1e18,
        type: "protocol" as const,
      }));
  }, [markets]);

  const externalAssets = useMemo<ExternalAsset[]>(() => {
    const balances = tokenBalances ?? [];
    if (balances.length === 0 || !markets) return [];

    const filtered = balances.filter(
      ({ address }) => !markets.some(({ asset }) => address.toLowerCase() === asset.toLowerCase()),
    );

    return filtered.map((externalAsset) => ({
      ...externalAsset,
      usdValue: (Number(externalAsset.priceUSD) * Number(externalAsset.amount ?? 0n)) / 10 ** externalAsset.decimals,
      type: "external" as const,
    }));
  }, [tokenBalances, markets]);

  const assets = useMemo<PortfolioAsset[]>(() => {
    const combined = [...protocolAssets, ...externalAssets];
    return combined.sort((a, b) => {
      if (options?.sortBy === "usdcFirst") {
        const aSymbol = a.type === "protocol" ? a.symbol.slice(3) : a.symbol;
        const bSymbol = b.type === "protocol" ? b.symbol.slice(3) : b.symbol;
        if (aSymbol === "USDC" && bSymbol !== "USDC") return -1;
        if (bSymbol === "USDC" && aSymbol !== "USDC") return 1;
      }
      return b.usdValue - a.usdValue;
    });
  }, [protocolAssets, externalAssets, options?.sortBy]);

  return {
    portfolio,
    averageRate,
    assets,
    protocolAssets,
    externalAssets,
    isPending: isExternalPending || isMarketsPending,
  };
}
