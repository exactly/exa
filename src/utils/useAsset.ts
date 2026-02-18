import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { borrowLimit, withdrawLimit } from "@exactly/lib";

import { tokenBalancesOptions } from "./lifi";
import useAccount from "./useAccount";

import type { Address } from "viem";

export default function useAsset(address?: Address) {
  const { address: account } = useAccount();
  const {
    data: markets,
    queryKey,
    isFetching: isMarketsFetching,
  } = useReadPreviewerExactly({
    address: previewerAddress,
    args: account ? [account] : undefined,
    query: { enabled: !!account },
  });
  const market = useMemo(() => markets?.find(({ market: m }) => m === address), [address, markets]);
  const { data: tokenBalances, isFetching: isTokenBalancesFetching } = useQuery(tokenBalancesOptions(account));
  const externalAsset = useMemo(
    () => tokenBalances?.find((token) => token.address.toLowerCase() === address?.toLowerCase()) ?? null,
    [tokenBalances, address],
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
    available,
    borrowAvailable,
    externalAsset,
    queryKey,
    isFetching: isMarketsFetching || isTokenBalancesFetching,
  };
}
