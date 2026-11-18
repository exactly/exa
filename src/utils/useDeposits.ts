import { useMemo } from "react";

import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import chain, { networks } from "@exactly/common/generated/chain";
import { floatingDepositRates } from "@exactly/lib";

import marketsOptions, { ratesOptions } from "./marketsOptions";
import useAccount from "./useAccount";

import type { ProtocolAsset } from "./usePortfolio";

export default function useDeposits() {
  const { address: account } = useAccount();
  const markets = useQueries({ queries: remotes.map((chainId) => marketsOptions(account, chainId)), combine });
  const snapshots = useQueries({ queries: remotes.map((chainId) => ratesOptions(chainId)), combine });
  return useMemo<ProtocolAsset[]>(
    () =>
      markets.flatMap((data, index) => {
        if (!data) return [];
        const snapshot = snapshots[index];
        const rates = snapshot ? floatingDepositRates(snapshot[0], Number(snapshot[1])) : [];
        return data
          .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0n)
          .map((market) => ({
            ...market,
            rate: rates.find(({ market: address }) => address === market.market)?.rate,
            symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
            type: "protocol" as const,
            usdValue: Number((market.floatingDepositAssets * market.usdPrice) / 10n ** BigInt(market.decimals)) / 1e18,
          }));
      }),
    [markets, snapshots],
  );
}

function combine<T>(results: UseQueryResult<T>[]) {
  return results.map(({ data }) => data);
}

const remotes = networks.has(chain.id) ? [...networks.keys()].filter((id) => id !== chain.id) : [];
