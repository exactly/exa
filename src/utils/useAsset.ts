import { previewerAddress } from "@exactly/common/generated/chain";
import { withdrawLimit } from "@exactly/lib";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { zeroAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { getAsset, getTokenBalances } from "./lifi";
import { useReadPreviewerExactly } from "../generated/contracts";

export default function useAsset(address?: Address) {
  let { address: account } = useAccount();
  if (account) account = "0xff6153d4920a2c9D0a6e1ad111b50cf1bEB2a289";
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
    queryKey: ["available", address, market?.asset, externalAsset, account], // eslint-disable-line @tanstack/query/exhaustive-deps
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
  return {
    address,
    account,
    market,
    markets,
    available,
    externalAsset,
    queryKey,
    isFetching: isMarketsFetching || isExternalAssetFetching,
  };
}
