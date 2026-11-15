import { useMemo } from "react";

import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import chain, { chains } from "@exactly/common/generated/chain";
import { floatingDepositRates } from "@exactly/lib";

import marketsOptions, { ratesOptions, type NetworkMarkets, type NetworkRates } from "./marketsOptions";
import useAccount from "./useAccount";

import type { ProtocolAsset } from "./usePortfolio";

export default function useDeposits() {
  const { address: account } = useAccount();
  const markets = useQueries({ queries: remotes.map((chainId) => marketsOptions(account, chainId)), combine });
  const snapshots = useQueries({ queries: remotes.map((chainId) => ratesOptions(chainId)), combine });
  return useMemo(
    () => markets.flatMap((data, index) => (data ? toProtocolAssets(data, snapshots[index]) : [])),
    [markets, snapshots],
  );
}

function toProtocolAssets(markets: NetworkMarkets, snapshot?: NetworkRates): ProtocolAsset[] {
  const rates = snapshot ? floatingDepositRates(snapshot.markets, Number(snapshot.timestamp)) : [];
  return markets
    .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n)
    .map((market) => ({
      ...market,
      rate: rates.find(({ market: address }) => address === market.market)?.rate,
      symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
      type: "protocol" as const,
      usdValue: Number((market.floatingDepositAssets * market.usdPrice) / 10n ** BigInt(market.decimals)) / 1e18,
    }));
}

function combine<T>(results: UseQueryResult<T>[]) {
  return results.map(({ data }) => data);
}

const remotes = chains.has(chain.id) ? [...chains.keys()].filter((id) => id !== chain.id) : [];
