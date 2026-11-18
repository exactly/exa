import { useCallback, useMemo } from "react";

import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import chain, { chains } from "@exactly/common/generated/chain";
import { floatingDepositRates } from "@exactly/lib";

import networkOptions from "./networkOptions";
import useAccount from "./useAccount";

import type { ProtocolAsset } from "./usePortfolio";

export default function useDeposits() {
  const { address: account } = useAccount();
  const previews = useQueries({
    queries: (chains.has(chain.id) ? [...chains.keys()].filter((id) => id !== chain.id) : []).map((chainId) =>
      networkOptions(account, chainId),
    ),
    combine: useCallback(<T>(results: UseQueryResult<T>[]) => results.map(({ data }) => data), []),
  });
  return useMemo<ProtocolAsset[]>(
    () =>
      previews.flatMap((data) => {
        if (!data?.markets) return [];
        const rates = data.snapshot ? floatingDepositRates(data.snapshot, Number(data.timestamp)) : [];
        return data.markets
          .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n)
          .map((market) => ({
            ...market,
            rate: rates.find(({ market: address }) => address === market.market)?.rate,
            symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
            type: "protocol" as const,
            usdValue: Number((market.floatingDepositAssets * market.usdPrice) / 10n ** BigInt(market.decimals)) / 1e18,
          }));
      }),
    [previews],
  );
}
