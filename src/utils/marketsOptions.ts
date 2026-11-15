import { queryOptions, skipToken } from "@tanstack/react-query";
import { readContract, readContracts } from "@wagmi/core/actions";
import { multicall3Abi } from "viem";

import {
  alchemyChains,
  appPreviewerAbi,
  appPreviewerCode,
  networks,
  previewerAbi,
} from "@exactly/common/generated/chain";
import { ratePreviewerAbi } from "@exactly/common/generated/hooks";

import exaConfig from "./wagmi/exa";

import type { Address } from "viem";

export default function marketsOptions(account: Address | undefined, chainId: number) {
  return queryOptions({
    queryKey: ["markets", account, chainId],
    staleTime: 10_000,
    queryFn: account ? () => read(account, chainId) : skipToken,
  });
}

export function ratesOptions(chainId: number) {
  return queryOptions({
    queryKey: ["rates", chainId],
    staleTime: 10_000,
    refetchInterval: ({ state }) => (state.status === "error" ? 60_000 : false),
    queryFn: () => snapshot(chainId),
  });
}

export type NetworkMarkets = Awaited<ReturnType<typeof read>>;
export type NetworkRates = Awaited<ReturnType<typeof snapshot>>;

async function read(account: Address, chainId: number) {
  const { auditor, previewer } = network(chainId);
  const [accountMarkets, previews] = await Promise.all([
    readContract(exaConfig, {
      chainId,
      address: previewer,
      abi: previewerAbi,
      functionName: "exactly",
      args: [account],
    }),
    readContract(exaConfig, {
      chainId,
      abi: appPreviewerAbi,
      functionName: "markets",
      code: appPreviewerCode,
      args: [auditor],
    }),
  ]);
  return withPreviews(accountMarkets, previews).map((market) => ({ ...market, chainId }));
}

async function snapshot(chainId: number) {
  const { multicall3, ratePreviewer } = network(chainId);
  const [markets, timestamp] = await readContracts(exaConfig, {
    allowFailure: false,
    contracts: [
      { chainId, address: ratePreviewer, abi: ratePreviewerAbi, functionName: "snapshot" },
      { chainId, address: multicall3, abi: multicall3Abi, functionName: "getCurrentBlockTimestamp" },
    ],
  });
  return { markets, timestamp };
}

export function withPreviews<T extends { isCollateral: boolean; market: Address }>(
  markets: readonly T[],
  previews: readonly { isFrozen: boolean; market: Address; nonCollateral: boolean }[],
) {
  return markets.map((market) => {
    const preview = previews.find(({ market: address }) => address === market.market);
    return {
      ...market,
      isCollateral: market.isCollateral && !preview?.nonCollateral,
      isFrozen: !!preview?.isFrozen,
      nonCollateral: !!preview?.nonCollateral,
    };
  });
}

function network(chainId: number) {
  const found = networks.get(chainId);
  const multicall3 = alchemyChains.get(chainId)?.contracts?.multicall3?.address;
  if (!found || !multicall3) throw new Error(`unknown network ${chainId}`);
  return { ...found, multicall3 };
}
