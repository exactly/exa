import { useMemo } from "react";

import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import chain, { chains } from "@exactly/common/generated/chain";

import networkOptions, { network } from "./networkOptions";
import useAccount from "./useAccount";
import useMarkets from "./useMarkets";

export default function useDebts(query?: { refetchInterval?: number }) {
  const { address: account } = useAccount();
  const { markets, timestamp } = useMarkets(query);
  const remote = useQueries({
    queries: remotes.map((id) => ({ ...networkOptions(account, id), ...query })),
    combine: settled,
  });
  return useMemo(() => {
    if (!markets) return { complete: false };
    const debts = [
      { chainId: chain.id, data: markets, now: timestamp },
      ...remotes.map((chainId, index) => ({
        chainId,
        data: remote.data[index]?.markets,
        now: remote.data[index]?.now ?? timestamp,
      })),
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
  }, [markets, remote, timestamp]);
}

function settled<M>(results: UseQueryResult<{ markets?: M; timestamp: bigint }>[]) {
  return {
    data: results.map(
      ({ data, isError }) => data && { markets: data.markets, now: isError ? undefined : data.timestamp },
    ),
    complete: results.every(({ data }) => data !== undefined),
  };
}

const remotes = [...chains.keys()].filter((id) => id !== chain.id);
