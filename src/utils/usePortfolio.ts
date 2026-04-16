import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";
import { floatingDepositRates, withdrawLimit } from "@exactly/lib";

import { balancesOptions } from "./lifi";
import useAccount from "./useAccount";
import useMarkets from "./useMarkets";

import type { Hex } from "@exactly/common/validation";
import type { TokenAmount } from "@lifi/sdk";

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
  chainId: number;
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
  const { markets, rateSnapshot, timestamp, isPending: isMarketsPending } = useMarkets();

  const { data: balances, isLoading: isBalancesPending } = useQuery(balancesOptions(account));

  const protocolSymbols = useMemo(() => {
    if (!markets) return [];
    const excluded = new Set(["USDC.e", "DAI", "WETH"]);
    const symbols = new Set(markets.map((m) => m.symbol.slice(3)).filter((s) => !excluded.has(s)));
    symbols.add("ETH");
    return [...symbols];
  }, [markets]);

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
    () => (rateSnapshot ? floatingDepositRates(rateSnapshot, Number(timestamp)) : []),
    [rateSnapshot, timestamp],
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
    const tokens = balances?.[chain.id] ?? [];
    if (!markets || tokens.length === 0) return [];
    const marketAddresses = new Set(markets.map(({ market }) => market.toLowerCase()));
    return tokens
      .filter((token) => !marketAddresses.has(token.address.toLowerCase()))
      .flatMap((token) => {
        const asset = toExternalAsset(token, chain.id);
        return asset ? [asset] : [];
      });
  }, [balances, markets]);

  const crossChainAssets = useMemo<ExternalAsset[]>(() => {
    if (!balances) return [];
    const result: ExternalAsset[] = [];
    for (const [chainIdKey, tokens] of Object.entries(balances)) {
      const chainId = Number(chainIdKey);
      if (!Number.isInteger(chainId) || chainId === chain.id) continue;
      for (const token of tokens) {
        const asset = toExternalAsset(token, chainId);
        if (asset) result.push(asset);
      }
    }
    return result;
  }, [balances]);

  const assets = useMemo<PortfolioAsset[]>(
    () => [...protocolAssets, ...externalAssets].sort(compareAssets(options?.sortBy)),
    [protocolAssets, externalAssets, options?.sortBy],
  );

  const allAssets = useMemo<PortfolioAsset[]>(
    () => [...protocolAssets, ...externalAssets, ...crossChainAssets].sort(compareAssets(options?.sortBy)),
    [protocolAssets, externalAssets, crossChainAssets, options?.sortBy],
  );

  const externalUSD = useMemo(() => externalAssets.reduce((sum, asset) => sum + asset.usdValue, 0), [externalAssets]);

  const totalBalanceUSD = useMemo(() => {
    const crossChainUSD = crossChainAssets.reduce((sum, asset) => sum + asset.usdValue, 0);
    return portfolio.balanceUSD + BigInt(Math.round((externalUSD + crossChainUSD) * 1e18));
  }, [portfolio.balanceUSD, externalUSD, crossChainAssets]);

  return {
    portfolio,
    averageRate,
    assets,
    allAssets,
    protocolAssets,
    externalAssets,
    crossChainAssets,
    totalBalanceUSD,
    protocolSymbols,
    markets,
    isPending: isMarketsPending,
    isBalancesPending,
  };
}

function compareAssets(sortBy: "usdcFirst" | "usdValue" | undefined) {
  return function compare(a: PortfolioAsset, b: PortfolioAsset) {
    if (sortBy === "usdcFirst") {
      if (a.symbol === "USDC" && b.symbol !== "USDC") return -1;
      if (b.symbol === "USDC" && a.symbol !== "USDC") return 1;
    }
    return b.usdValue - a.usdValue;
  };
}

function toExternalAsset(token: TokenAmount, chainId: number): ExternalAsset | undefined {
  if (!token.amount || token.amount <= 0n) return undefined;
  const rawUsd = (Number(token.priceUSD) * Number(token.amount)) / 10 ** token.decimals;
  const usdValue = Number.isFinite(rawUsd) && rawUsd > 0 ? rawUsd : 0;
  return {
    address: token.address,
    amount: token.amount,
    chainId,
    decimals: token.decimals,
    logoURI: token.logoURI,
    name: token.name,
    priceUSD: token.priceUSD,
    symbol: token.symbol,
    type: "external",
    usdValue,
  };
}
