import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import { chains } from "@exactly/common/generated/chain";

import networkOptions, { network } from "./networkOptions";
import useAccount from "./useAccount";

import type useMarkets from "./useMarkets";

export default function useDebts(query?: { refetchInterval?: number }) {
  const { address: account } = useAccount();
  return useQueries({
    queries: networks.map((id) => ({ ...networkOptions(account, id), ...query })),
    combine: settled,
  });
}

function settled(results: UseQueryResult<{ markets?: ReturnType<typeof useMarkets>["markets"]; timestamp: bigint }>[]) {
  const latest = results.reduce((max, { data }) => (data && data.timestamp > max ? data.timestamp : max), 0n);
  const usdc = results.flatMap(({ data, isError }) => {
    const market = data?.markets?.find(({ chainId, market: address }) => address === network(chainId).marketUSDC);
    return data && market ? [{ ...market, now: isError ? latest : data.timestamp }] : [];
  });
  return {
    debts: usdc
      .flatMap(({ chainId, decimals, fixedBorrowPositions, now }) =>
        fixedBorrowPositions.flatMap(({ maturity, previewValue, position: { principal, fee } }) =>
          previewValue > 0n && principal + fee > 0n
            ? [{ chainId, maturity, previewValue, position: principal + fee, overdue: maturity < now, now, decimals }]
            : [],
        ),
      )
      .sort((a, b) => Number(a.maturity - b.maturity) || a.chainId - b.chainId),
    penalty: Math.max(...usdc.map(({ penaltyRate }) => Number(penaltyRate * 86_400n) / 1e18)),
    complete: results.every(({ data }) => data !== undefined),
  };
}

const networks = [...chains.keys()];
