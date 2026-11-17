import { useMemo } from "react";

import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import chain, { chains } from "@exactly/common/generated/chain";

import marketsOptions, { network, ratesOptions } from "./marketsOptions";
import useAccount from "./useAccount";
import useMarkets from "./useMarkets";

export default function useDebts(query?: { refetchInterval?: number }) {
  const { address: account } = useAccount();
  const { markets, timestamp } = useMarkets(query);
  const remote = useQueries({
    queries: remotes.map((id) => ({ ...marketsOptions(account, id), ...query })),
    combine: settled,
  });
  const rates = useQueries({ queries: remotes.map((id) => ({ ...ratesOptions(id), ...query })), combine: fresh });
  return useMemo(() => {
    if (!markets) return { complete: false };
    const debts = [
      { chainId: chain.id, data: markets, now: timestamp },
      ...remotes.map((chainId, index) => ({ chainId, data: remote.data[index], now: rates[index]?.[1] ?? timestamp })),
    ]
      .flatMap(({ chainId, data, now }) =>
        (data?.find(({ market }) => market === network(chainId).marketUSDC)?.fixedBorrowPositions ?? []).flatMap(
          ({ maturity, previewValue, position: { principal, fee } }) =>
            previewValue > 0n && principal + fee > 0n
              ? [{ chainId, maturity, previewValue, position: principal + fee, overdue: maturity < now }]
              : [],
        ),
      )
      .sort((a, b) => Number(a.maturity - b.maturity) || a.chainId - b.chainId);
    return { debts, complete: remote.complete };
  }, [markets, rates, remote, timestamp]);
}

function combine<T>(results: UseQueryResult<T>[]) {
  return results.map(({ data }) => data);
}

function fresh<T>(results: UseQueryResult<T>[]) {
  return results.map(({ data, isError }) => (isError ? undefined : data));
}

function settled<T>(results: UseQueryResult<T>[]) {
  return { data: combine(results), complete: results.every(({ data }) => data !== undefined) };
}

const remotes = [...chains.keys()].filter((id) => id !== chain.id);
