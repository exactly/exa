import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";
import { borrowLimit, withdrawLimit } from "@exactly/lib";

import { balancesOptions } from "./lifi";
import useAccount from "./useAccount";
import useMarkets from "./useMarkets";

import type { Address } from "viem";

export default function useAsset(address?: Address) {
  const { address: account } = useAccount();
  const { markets, timestamp, firstMaturity, queryKey, isFetching: isMarketsFetching } = useMarkets();
  const market = useMemo(() => markets?.find(({ market: m }) => m === address), [address, markets]);
  const { data: balances, isFetching: isBalancesFetching } = useQuery(balancesOptions(account));
  const externalAsset = useMemo(
    () => balances?.[chain.id]?.find((token) => token.address.toLowerCase() === address?.toLowerCase()) ?? null,
    [balances, address],
  );
  const available = useMemo(() => {
    if (markets && market) return withdrawLimit(markets, market.market);
    return externalAsset?.amount ?? 0n;
  }, [markets, market, externalAsset]);
  const borrowAvailable = useMemo(() => {
    if (markets && market && !externalAsset) return borrowLimit(markets, market.market);
    return 0n;
  }, [markets, market, externalAsset]);

  return {
    address,
    account,
    market,
    markets,
    timestamp,
    firstMaturity,
    available,
    borrowAvailable,
    externalAsset,
    queryKey,
    isFetching: isMarketsFetching || isBalancesFetching,
  };
}
