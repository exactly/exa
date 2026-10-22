import { useCallback } from "react";

import { queryOptions, skipToken, useQueries, type UseQueryResult } from "@tanstack/react-query";
import { getContractEvents, readContract } from "@wagmi/core/actions";
import { zeroAddress } from "viem";

import chain, {
  alchemyChains,
  allowlists,
  appPreviewerAbi,
  appPreviewerCode,
  factoryChains,
  proposalManagerAbi,
} from "@exactly/common/generated/chain";

import useAccount from "./useAccount";
import exaConfig from "./wagmi/exa";

import type { Allowlists } from "./lifi";

export default function useAllowlists() {
  const { address } = useAccount();
  return useQueries({
    queries: chains.map((chainId) =>
      queryOptions({
        queryKey: ["allowlist", chainId, address],
        staleTime: 5 * 60_000,
        gcTime: Infinity,
        queryFn: address
          ? async () => {
              const { proposalManager } = await readContract(exaConfig, {
                chainId,
                abi: appPreviewerAbi,
                functionName: "proposalManager",
                code: appPreviewerCode,
                args: [address],
              });
              if (proposalManager === zeroAddress) return null;
              const targets = new Set<string>();
              for (const { args } of await getContractEvents(exaConfig, {
                chainId,
                address: proposalManager,
                abi: proposalManagerAbi,
                eventName: "TargetAllowed",
                fromBlock: BigInt(factoryChains.get(chainId)?.startBlock ?? 0),
                strict: true,
              })) {
                if (args.allowed) targets.add(args.target.toLowerCase());
                else targets.delete(args.target.toLowerCase());
              }
              return [...targets];
            }
          : skipToken,
      }),
    ),
    combine: useCallback(
      (results: UseQueryResult<null | readonly string[]>[]): Allowlists =>
        Object.fromEntries(
          snapshot.map(([id, fallback]) => {
            const targets = results[chains.indexOf(id)]?.data;
            return [id, targets ? new Set(targets) : fallback];
          }),
        ),
      [],
    ),
  });
}

export const chains = Object.keys(allowlists)
  .map(Number)
  .filter((id) => Number.isInteger(id) && (id === chain.id || alchemyChains.get(id)?.smartAccount));

const snapshot = Object.entries(allowlists).map(
  ([id, targets]) => [Number(id), targets && new Set(targets.map((target) => target.toLowerCase()))] as const,
);
