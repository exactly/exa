import { queryOptions, skipToken } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";
import { zeroAddress } from "viem";

import { appPreviewerAbi, appPreviewerCode, chains } from "@exactly/common/generated/chain";
import { ratePreviewerAbi } from "@exactly/common/generated/hooks";

import { protocolOf, withFlags } from "./networkOptions";
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
  const { protocol } = await readContract(exaConfig, {
    chainId,
    abi: appPreviewerAbi,
    functionName: "preview",
    code: appPreviewerCode,
    args: [account, [], { ...protocolOf(chainId), ratePreviewer: zeroAddress }],
  });
  return protocol.markets.map((row) => ({ ...withFlags(row.market, row), chainId }));
}

function network(chainId: number) {
  const found = chains.get(chainId);
  if (!found) throw new Error(`unknown network ${chainId}`);
  return found;
}
