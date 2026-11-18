import { useMemo } from "react";

import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import chain, { chains } from "@exactly/common/generated/chain";
import { floatingDepositRates } from "@exactly/lib";

import networkOptions from "./networkOptions";
import useAccount from "./useAccount";

import type { ProtocolAsset } from "./usePortfolio";

export default function useDeposits() {
  const { address: account } = useAccount();
  const previews = useQueries({ queries: remotes.map((chainId) => networkOptions(account, chainId)), combine });
  return useMemo<ProtocolAsset[]>(
    () =>
      previews.flatMap((data) => {
        if (!data?.markets) return [];
        const floating = data.snapshot ? floatingDepositRates(data.snapshot, Number(data.timestamp)) : [];
        return data.markets
          .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n)
          .map((market) => ({
            ...market,
            rate: floating.find(({ market: address }) => address === market.market)?.rate,
            symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
            type: "protocol" as const,
            usdValue: Number((market.floatingDepositAssets * market.usdPrice) / 10n ** BigInt(market.decimals)) / 1e18,
          }));
      }),
    [previews],
  );
}

export function useNetworkMarkets() {
  const { address: account } = useAccount();
  const results = useQueries({ queries: ids.map((chainId) => networkOptions(account, chainId)), combine: status });
  return useMemo(
    () => ({
      markets: new Map(ids.map((chainId, index) => [chainId, results[index]?.data?.markets] as const)),
      loading: new Set(ids.filter((_, index) => results[index]?.isPending)),
    }),
    [results],
  );
}

function combine<T>(results: UseQueryResult<T>[]) {
  return results.map(({ data }) => data);
}

function status<T>(results: UseQueryResult<T>[]) {
  return results.map(({ data, isPending }) => ({ data, isPending }));
}

const remotes = chains.has(chain.id) ? [...chains.keys()].filter((id) => id !== chain.id) : [];
const ids = [chain.id, ...remotes];
