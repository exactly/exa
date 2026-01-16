import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { zeroAddress, type Address } from "viem";

import { previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { borrowLimit, withdrawLimit } from "@exactly/lib";

import { getAsset, getTokenBalances } from "./lifi";
import useAccount from "./useAccount";

export default function useAsset(address?: Address) {
  const { address: account } = useAccount();
  const { data: externalAsset, isFetching: isExternalAssetFetching } = useQuery({
    initialData: null,
    queryKey: ["asset", address],
    queryFn: async () => {
      const asset = await getAsset(address ?? zeroAddress);
      return asset ?? null;
    },
    enabled: !!address && !!account,
  });
  const {
    data: markets,
    queryKey,
    isFetching: isMarketsFetching,
  } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });
  const market = useMemo(() => markets?.find(({ market: m }) => m === address), [address, markets]);
  const { data: available } = useQuery({
    initialData: 0n,
    queryKey: ["available", address, market?.asset, externalAsset, account, markets, market],
    queryFn: async () => {
      if (markets && market) {
        return withdrawLimit(markets, market.market);
      } else if (externalAsset && account) {
        const balances = await getTokenBalances(account);
        const balance = balances.find((token) => token.address === externalAsset.address);
        return balance?.amount ?? 0n;
      }
      return 0n;
    },
    enabled: !!address && !!account,
  });
  const { data: borrowAvailable } = useQuery({
    initialData: 0n,
    queryKey: ["borrowAvailable", address, market?.asset, externalAsset, account, markets, market],
    queryFn: () => {
      if (markets && market) return borrowLimit(markets, market.market);
      return 0n;
    },
    enabled: !!address && !!account && !externalAsset,
  });

  return {
    address,
    account,
    market,
    markets,
    available,
    borrowAvailable,
    externalAsset,
    queryKey,
    isFetching: isMarketsFetching || isExternalAssetFetching,
  };
}
