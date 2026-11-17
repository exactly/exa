import { useCallback, useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { safeParse } from "valibot";
import { formatUnits } from "viem";

import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { floatingDepositRates, WAD, withdrawLimit } from "@exactly/lib";

import { balancesOptions } from "./lifi";
import useAccount from "./useAccount";
import useMarkets from "./useMarkets";

import type { Hex, Address as ViemAddress } from "@exactly/common/validation";
import type { TokenAmount } from "@lifi/sdk";

export type ProtocolAsset = {
  asset: Hex;
  assetName: string;
  chainId: number;
  decimals: number;
  floatingDepositAssets: bigint;
  isFrozen: boolean;
  market: Hex;
  nonCollateral: boolean;
  rate?: bigint;
  symbol: string;
  type: "protocol";
  usdPrice: bigint;
  usdValue: number;
};

export type ExternalAsset = {
  address: ViemAddress;
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

export default function usePortfolio(options?: {
  chainId?: number;
  deposits?: ProtocolAsset[];
  sortBy?: "usdcFirst" | "usdValue";
}) {
  const { address: account } = useAccount();
  const deposits = options?.deposits ?? none;
  const network = options?.chainId ?? chain.id;
  const {
    markets,
    supportedAssets,
    rateSnapshot,
    timestamp,
    isPending: isMarketsPending,
  } = useMarkets(undefined, network);

  const { data: balances, isLoading: isBalancesPending } = useQuery(balancesOptions(account));

  const portfolio = useMemo(() => {
    if (!markets) return { depositMarkets: [], balanceUSD: 0n, collateralUSD: 0n };

    const depositMarkets: { market: string; symbol: string; usdValue: bigint }[] = [];
    let balanceUSD = 0n;
    let collateralUSD = 0n;
    for (const { floatingDepositAssets, usdPrice, decimals, market, nonCollateral, symbol } of markets) {
      if (floatingDepositAssets <= 0n) continue;
      const usdValue = (floatingDepositAssets * usdPrice) / 10n ** BigInt(decimals);
      if (usdValue <= 0n) continue;
      balanceUSD += usdValue;
      if (nonCollateral) continue;
      depositMarkets.push({ market, symbol: symbol.slice(3) === "WETH" ? "ETH" : symbol.slice(3), usdValue });
      collateralUSD += usdValue;
    }

    return { balanceUSD, collateralUSD, depositMarkets } as const;
  }, [markets]);

  const rates = useMemo(() => {
    if (!rateSnapshot || !markets) return [];
    const reserved = new Set<string>(
      markets.filter(({ reserveFactor }) => reserveFactor >= WAD).map(({ market }) => market),
    );
    return floatingDepositRates(rateSnapshot, Number(timestamp)).filter(({ market }) => !reserved.has(market));
  }, [markets, rateSnapshot, timestamp]);

  const collateral = useMemo(() => deposits.filter(({ nonCollateral }) => !nonCollateral), [deposits]);

  const averageRate = useMemo(() => {
    const rateByMarket = new Map(rates.map(({ market, rate }) => [market, rate]));

    let weightedRate = 0n;
    let ratedUSD = 0n;
    if (rateSnapshot) {
      for (const { market, usdValue } of portfolio.depositMarkets) {
        weightedRate += (rateByMarket.get(market) ?? 0n) * usdValue;
        ratedUSD += usdValue;
      }
    }
    for (const { rate, usdValue } of collateral) {
      if (rate === undefined) continue;
      const value = BigInt(Math.round(usdValue * 1e18));
      weightedRate += rate * value;
      ratedUSD += value;
    }

    return ratedUSD === 0n ? undefined : weightedRate / ratedUSD;
  }, [collateral, portfolio.depositMarkets, rateSnapshot, rates]);

  const protocolAssets = useMemo<ProtocolAsset[]>(() => {
    if (!markets) return [];
    return markets
      .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n)
      .map((market) => ({
        ...market,
        chainId: network,
        symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
        usdValue:
          Number((withdrawLimit(markets, market.market) * market.usdPrice) / BigInt(10 ** market.decimals)) / 1e18,
        type: "protocol" as const,
      }));
  }, [markets, network]);

  const externalAssets = useMemo<ExternalAsset[]>(() => {
    const tokens = balances?.[network] ?? [];
    if (!markets || tokens.length === 0) return [];
    const marketAddresses = new Set(markets.map(({ market }) => market.toLowerCase()));
    return tokens
      .filter((token) => !marketAddresses.has(token.address.toLowerCase()))
      .flatMap((token) => {
        const asset = toExternalAsset(token);
        return asset ? [asset] : [];
      });
  }, [balances, markets, network]);

  const isExternal = useCallback(
    (chainId: number, address: string) => {
      if (chainId !== network) return true;
      if (!markets) return false;
      return !markets.some(
        (m) =>
          m.asset === address &&
          (!m.isFrozen ||
            (protocolAssets.some((a) => a.asset === address) &&
              !externalAssets.some((a) => a.address === address && (a.amount ?? 0n) > 0n))),
      );
    },
    [externalAssets, markets, network, protocolAssets],
  );

  const crossChainAssets = useMemo<ExternalAsset[]>(() => {
    if (!balances) return [];
    return Object.entries(balances)
      .filter(([id]) => Number(id) !== network)
      .flatMap(([, tokens]) => tokens)
      .flatMap((token) => {
        const asset = toExternalAsset(token);
        return asset ? [asset] : [];
      });
  }, [balances, network]);

  const assets = useMemo<PortfolioAsset[]>(
    () => [...protocolAssets, ...externalAssets].sort(compareAssets(options?.sortBy)),
    [protocolAssets, externalAssets, options?.sortBy],
  );

  const allAssets = useMemo<PortfolioAsset[]>(
    () => [...protocolAssets, ...externalAssets, ...crossChainAssets, ...deposits].sort(compareAssets(options?.sortBy)),
    [protocolAssets, externalAssets, crossChainAssets, deposits, options?.sortBy],
  );

  const externalUSD = useMemo(() => externalAssets.reduce((sum, asset) => sum + asset.usdValue, 0), [externalAssets]);

  const totalBalanceUSD = useMemo(() => {
    const crossChainUSD = [crossChainAssets, deposits].flat().reduce((sum, asset) => sum + asset.usdValue, 0);
    return portfolio.balanceUSD + BigInt(Math.round((externalUSD + crossChainUSD) * 1e18));
  }, [portfolio.balanceUSD, externalUSD, crossChainAssets, deposits]);

  return {
    portfolio,
    averageRate,
    rates,
    assets,
    allAssets,
    protocolAssets,
    externalAssets,
    crossChainAssets,
    collateralUSD: useMemo(
      () =>
        portfolio.collateralUSD +
        BigInt(Math.round(collateral.reduce((sum, { usdValue }) => sum + usdValue, 0) * 1e18)),
      [collateral, portfolio.collateralUSD],
    ),
    isExternal,
    totalBalanceUSD,
    protocolSymbols: supportedAssets,
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

function toExternalAsset(token: TokenAmount): ExternalAsset | undefined {
  if (!token.amount) return undefined;
  const address = safeParse(Address, token.address);
  if (!address.success) return undefined;
  const rawUsd = Number(formatUnits(token.amount, token.decimals)) * Number(token.priceUSD);
  const usdValue = Number.isFinite(rawUsd) && rawUsd > 0 ? rawUsd : 0;
  return { ...token, address: address.output, type: "external", usdValue };
}

const none: ProtocolAsset[] = [];
