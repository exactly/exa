import chain, { previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import type { Chain, Token } from "@lifi/sdk";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { zeroAddress } from "viem";

import { getBridgeSources, type BridgeSources } from "./lifi";

export default function useBridgeData(senderAddress?: string) {
  const { data: markets } = useReadPreviewerExactly({
    address: previewerAddress,
    args: [zeroAddress],
  });

  const protocolSymbols = useMemo(() => {
    if (!markets) return [];
    return [
      ...new Set([
        ...markets.map((m) => m.symbol.slice(3)).filter((s) => !["USDC.e", "DAI", "WETH"].includes(s)),
        "ETH",
      ]),
    ];
  }, [markets]);

  const {
    data: bridge,
    isPending,
    error,
  } = useQuery<BridgeSources>({
    queryKey: ["bridge", "sources", senderAddress, protocolSymbols],
    queryFn: () => getBridgeSources(senderAddress, protocolSymbols),
    enabled: !!senderAddress && protocolSymbols.length > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const assetGroups = useMemo(() => {
    if (!bridge?.chains) return [];
    return bridge.chains.reduce<{ chain: Chain; assets: { token: Token; balance: bigint; usdValue: number }[] }[]>(
      (accumulator, chainItem) => {
        const assets = bridge.ownerAssetsByChain[chainItem.id] ?? [];
        if (assets.length > 0) accumulator.push({ chain: chainItem, assets });
        return accumulator;
      },
      [],
    );
  }, [bridge]);

  const destinationTokens = useMemo(() => bridge?.tokensByChain[chain.id] ?? [], [bridge]);
  const destinationBalances = useMemo(() => bridge?.balancesByChain[chain.id] ?? [], [bridge]);

  return { bridge, assetGroups, destinationTokens, destinationBalances, protocolSymbols, isPending, error };
}
