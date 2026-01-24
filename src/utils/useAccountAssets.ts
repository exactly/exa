import { useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";
import { anvil } from "viem/chains";

import chain from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { withdrawLimit } from "@exactly/lib";

import { getTokenBalances } from "./lifi";
import useAccount from "./useAccount";

export type ProtocolAsset = {
  asset: string;
  assetName: string;
  decimals: number;
  floatingDepositAssets: bigint;
  market: `0x${string}`;
  symbol: string;
  type: "protocol";
  usdPrice: bigint;
  usdValue: number;
};

export type ExternalAsset = {
  address: string;
  amount?: bigint;
  decimals: number;
  logoURI?: string;
  name: string;
  priceUSD: string;
  symbol: string;
  type: "external";
  usdValue: number;
};

export default function useAccountAssets(options?: { sortBy?: "usdcFirst" | "usdValue" }) {
  const { address: account } = useAccount();

  const { data: markets } = useReadPreviewerExactly({ args: [account ?? zeroAddress] });

  const { data: externalAssets, isPending: isExternalAssetsPending } = useQuery({
    queryKey: ["externalAssets", account],
    queryFn: async () => {
      if (chain.testnet || chain.id === anvil.id || !account) return [];
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
    return b.usdValue - a.usdValue;
  });

  return {
    accountAssets: combinedAssets,
    protocolAssets: protocol,
    externalAssets: external,
    isPending: isExternalAssetsPending,
  };
}
