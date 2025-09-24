import chain, { previewerAddress } from "@exactly/common/generated/chain";
import { withdrawLimit } from "@exactly/lib";
import { useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";
import { optimism } from "viem/chains";

import { getTokenBalances } from "./lifi";
import useAccount from "./useAccount";
import { useReadPreviewerExactly } from "../generated/contracts";

export interface ProtocolAsset {
  asset: string;
  type: "protocol";
  symbol: string;
  assetName: string;
  floatingDepositAssets: bigint;
  decimals: number;
  usdValue: number;
  market: `0x${string}`;
}

export interface ExternalAsset {
  type: "external";
  name: string;
  symbol: string;
  logoURI?: string;
  address: string;
  amount?: bigint;
  priceUSD: string;
  decimals: number;
  usdValue: number;
}

export default function useAccountAssets(options?: { sortBy?: "usdValue" | "usdcFirst" }) {
  const { address: account } = useAccount();

  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });

  const { data: externalAssets, isPending: isExternalAssetsPending } = useQuery({
    queryKey: ["externalAssets", account],
    queryFn: async () => {
      if (chain.id !== optimism.id || !account) return [];
      const balances = await getTokenBalances(account);
      return balances.filter(
        ({ address }) => markets && !markets.some(({ market }) => address.toLowerCase() === market.toLowerCase()),
      );
    },
    enabled: !!account,
  });

  const protocol = (markets ?? [])
    .map((market) => ({
      ...market,
      usdValue: markets
        ? Number((withdrawLimit(markets, market.market) * market.usdPrice) / BigInt(10 ** market.decimals)) / 1e18
        : 0,
      type: "protocol",
    }))
    .filter(({ floatingDepositAssets }) => floatingDepositAssets > 0) as ProtocolAsset[];

  const external = (externalAssets ?? []).map((externalAsset) => ({
    ...externalAsset,
    usdValue: (Number(externalAsset.priceUSD) * Number(externalAsset.amount ?? 0n)) / 10 ** externalAsset.decimals,
    type: "external",
  })) as ExternalAsset[];

  const combinedAssets = [...protocol, ...external].sort((a, b) => {
    if (options?.sortBy === "usdcFirst") return a.symbol.slice(3) === "USDC" ? -1 : 1;
    return Number(b.usdValue) - Number(a.usdValue);
  });

  return {
    accountAssets: combinedAssets,
    protocolAssets: protocol,
    externalAssets: external,
    isPending: isExternalAssetsPending,
  };
}
