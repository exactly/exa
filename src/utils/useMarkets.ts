import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { multicall3Abi, zeroAddress } from "viem";
import { useReadContracts } from "wagmi";

import chain, {
  marketAbi,
  marketUSDCAddress,
  previewerAbi,
  previewerAddress,
  ratePreviewerAddress,
} from "@exactly/common/generated/chain";
import { ratePreviewerAbi } from "@exactly/common/generated/hooks";
import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import { MATURITY_INTERVAL } from "@exactly/lib";

import networkOptions, { withFlags } from "./networkOptions";
import useAccount from "./useAccount";

export default function useMarkets(query?: { enabled?: boolean; gcTime?: number; refetchInterval?: number }) {
  const { address: account } = useAccount();
  const result = useReadContracts({
    allowFailure: false,
    contracts: [
      {
        address: previewerAddress,
        abi: previewerAbi,
        functionName: "exactly",
        args: [account ?? zeroAddress],
        chainId: chain.id,
      },
      { address: ratePreviewerAddress, abi: ratePreviewerAbi, functionName: "snapshot", chainId: chain.id },
      {
        address: chain.contracts.multicall3.address,
        abi: multicall3Abi,
        functionName: "getCurrentBlockTimestamp",
        chainId: chain.id,
      },
      { address: marketUSDCAddress, abi: marketAbi, functionName: "previewFloatingAssetsAverage", chainId: chain.id },
    ],
    query: { ...query, enabled: query?.enabled ?? true, staleTime: 10_000 },
  });
  const previews = useQuery({
    ...networkOptions(account, chain.id),
    enabled: query?.enabled ?? true,
    ...(query?.refetchInterval !== undefined && { refetchInterval: query.refetchInterval }),
    select: ({ markets: rows = [] }) => rows,
  });
  const accountMarkets = result.data?.[0];
  const markets = useMemo(
    () =>
      accountMarkets &&
      previews.data &&
      accountMarkets.map((market) =>
        withFlags(
          market,
          previews.data.find(({ market: address }) => address === market.market),
        ),
      ),
    [accountMarkets, previews.data],
  );
  const supportedAssets = useMemo(() => {
    if (!markets) return [];
    return markets
      .filter(({ isFrozen, nonCollateral }) => !isFrozen && !nonCollateral)
      .map(({ symbol }) => (symbol === "exaWETH" ? "ETH" : symbol.slice(3)))
      .filter((symbol) => symbol !== "DAI");
  }, [markets]);
  const timestamp = result.data?.[2] ?? BigInt(Math.floor(Date.now() / 1000)); // eslint-disable-line @eslint-react/purity -- fallback until onchain timestamp loads
  const now = Number(timestamp);
  const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
  return {
    markets,
    supportedAssets,
    rateSnapshot: result.data?.[1],
    floatingAssetsAverage: result.data?.[3],
    timestamp,
    firstMaturity: nextMaturity + MATURITY_INTERVAL * Number(nextMaturity - now < MIN_BORROW_INTERVAL),
    queryKey: result.queryKey,
    refetch: () => Promise.all([result.refetch(), previews.refetch()]),
    get isFetching() {
      return result.isFetching || previews.isFetching;
    },
    get isPending() {
      return result.isPending || previews.isPending;
    },
  };
}
