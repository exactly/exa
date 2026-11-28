import { useCallback, useMemo } from "react";

import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import chain, { chains } from "@exactly/common/generated/chain";
import { floatingDepositRates, WAD, withdrawLimit } from "@exactly/lib";

import networkOptions from "./networkOptions";
import useAccount from "./useAccount";

import type { ProtocolAsset } from "./usePortfolio";

export default function useDeposits() {
  const { address: account } = useAccount();
  const previews = useQueries({
    queries: remotes.map((chainId) => networkOptions(account, chainId)),
    combine: useCallback(
      <T>(results: UseQueryResult<T>[]) => ({
        data: results.map(({ data }) => data),
        failed: remotes.filter((_, index) => results[index]?.isError && results[index].data === undefined),
        isPending: results.some(({ isLoading }) => isLoading),
      }),
      [],
    ),
  });
  return {
    data: useMemo<ProtocolAsset[]>(
      () =>
        previews.data.flatMap((data) => {
          if (!data?.markets) return [];
          const floating = data.snapshot ? floatingDepositRates(data.snapshot, Number(data.timestamp)) : [];
          return data.markets
            .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n)
            .map((market) => ({
              ...market,
              rate:
                market.reserveFactor >= WAD
                  ? undefined
                  : floating.find(({ market: address }) => address === market.market)?.rate,
              symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
              type: "protocol" as const,
              usdValue:
                Number((market.floatingDepositAssets * market.usdPrice) / 10n ** BigInt(market.decimals)) / 1e18,
            }));
        }),
      [previews.data],
    ),
    failed: previews.failed,
    isPending: previews.isPending,
  };
}

export function useWithdrawableDeposits() {
  const { data: deposits } = useDeposits();
  const { markets } = useNetworkMarkets();
  return useMemo(
    () =>
      deposits.map((deposit) => {
        const network = markets.get(deposit.chainId);
        return {
          ...deposit,
          usdValue: network
            ? Number((withdrawLimit(network, deposit.market) * deposit.usdPrice) / BigInt(10 ** deposit.decimals)) /
              1e18
            : 0,
        };
      }),
    [deposits, markets],
  );
}

export function useNetworkMarkets() {
  const { address: account } = useAccount();
  const results = useQueries({
    queries: ids.map((chainId) => networkOptions(account, chainId)),
    combine: useCallback(
      <T>(previews: UseQueryResult<T>[]) => previews.map(({ data, isPending }) => ({ data, isPending })),
      [],
    ),
  });
  return useMemo(
    () => ({
      markets: new Map(ids.map((chainId, index) => [chainId, results[index]?.data?.markets] as const)),
      rates: new Map(
        ids.map((chainId, index) => {
          const data = results[index]?.data;
          return [chainId, data?.snapshot ? floatingDepositRates(data.snapshot, Number(data.timestamp)) : []] as const;
        }),
      ),
      loading: new Set(ids.filter((_, index) => results[index]?.isPending)),
    }),
    [results],
  );
}

const remotes = chains.has(chain.id) ? [...chains.keys()].filter((id) => id !== chain.id) : [];
const ids = [chain.id, ...remotes];
