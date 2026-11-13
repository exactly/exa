import { queryOptions, skipToken } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";

import { appPreviewerAbi, appPreviewerCode, networks, previewerAbi } from "@exactly/common/generated/chain";
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
    queryFn: () =>
      readContract(exaConfig, {
        chainId,
        address: network(chainId).ratePreviewer,
        abi: ratePreviewerAbi,
        functionName: "snapshot",
      }),
  });
}

export type NetworkMarkets = Awaited<ReturnType<typeof read>>;

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
  return accountMarkets.map((market) => {
    const preview = previews.find(({ market: address }) => address === market.market);
    return {
      ...market,
      chainId,
      isCollateral: market.isCollateral && !preview?.nonCollateral,
      isFrozen: !!preview?.isFrozen,
      nonCollateral: !!preview?.nonCollateral,
    };
  });
}

function network(chainId: number) {
  const found = networks.get(chainId);
  if (!found) throw new Error(`unknown network ${chainId}`);
  return found;
}
