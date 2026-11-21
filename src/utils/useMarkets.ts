import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";

import chain from "@exactly/common/generated/chain";
import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import { MATURITY_INTERVAL } from "@exactly/lib";

import networkOptions from "./networkOptions";
import useAccount from "./useAccount";

export default function useMarkets(
  query?: { enabled?: boolean; gcTime?: number; refetchInterval?: number },
  chainId = chain.id,
) {
  const { address: account } = useAccount();
  const options = networkOptions(account ?? zeroAddress, chainId);
  const result = useQuery({ ...options, ...query });
  const markets = result.data?.markets;
  const supportedAssets = useMemo(() => {
    if (!markets) return [];
    return markets
      .filter(({ isFrozen, nonCollateral }) => !isFrozen && !nonCollateral)
      .map(({ symbol }) => (symbol === "exaWETH" ? "ETH" : symbol.slice(3)))
      .filter((symbol) => symbol !== "DAI");
  }, [markets]);
  const timestamp = result.data?.timestamp ?? BigInt(Math.floor(Date.now() / 1000)); // eslint-disable-line @eslint-react/purity -- fallback until onchain timestamp loads
  const now = Number(timestamp);
  const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
  return {
    markets,
    supportedAssets,
    rateSnapshot: result.data?.snapshot,
    floatingAssetsAverage: result.data?.floatingAssetsAverage,
    timestamp,
    firstMaturity: nextMaturity + MATURITY_INTERVAL * Number(nextMaturity - now < MIN_BORROW_INTERVAL),
    queryKey: options.queryKey,
    refetch: result.refetch,
    get isFetching() {
      return result.isFetching;
    },
    get isPending() {
      return result.isPending;
    },
  };
}
