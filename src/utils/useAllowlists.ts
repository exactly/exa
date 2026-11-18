import { useCallback } from "react";

import { queryOptions, skipToken, useQueries, type UseQueryResult } from "@tanstack/react-query";
import { getBlock, getContractEvents, readContract } from "@wagmi/core/actions";
import { zeroAddress, type Address } from "viem";

import chain, {
  alchemyChains,
  allowlists,
  appPreviewerAbi,
  appPreviewerCode,
  proposalManagerAbi,
} from "@exactly/common/generated/chain";

import queryClient from "./queryClient";
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
        queryFn:
          address && !chain.testnet
            ? async ({ queryKey }): Promise<Allowlist | null> => {
                const { number: block } = await getBlock(exaConfig, { chainId, blockTag: "safe" }).catch(() =>
                  getBlock(exaConfig, { chainId, blockTag: "finalized" }),
                );
                const { proposalManager } = await readContract(exaConfig, {
                  chainId,
                  abi: appPreviewerAbi,
                  functionName: "proposalManager",
                  code: appPreviewerCode,
                  args: [address],
                  blockNumber: block,
                });
                if (proposalManager === zeroAddress) return null;
                const previous = queryClient.getQueryData<Allowlist | null>(queryKey);
                const resume = previous?.proposalManager === proposalManager ? previous : undefined;
                if (resume && block <= resume.block) return resume;
                const targets = new Set(resume?.targets);
                for (const { args } of await getContractEvents(exaConfig, {
                  chainId,
                  address: proposalManager,
                  abi: proposalManagerAbi,
                  eventName: "TargetAllowed",
                  fromBlock: resume ? resume.block + 1n : 0n,
                  toBlock: block,
                  strict: true,
                })) {
                  if (args.allowed) targets.add(args.target.toLowerCase());
                  else targets.delete(args.target.toLowerCase());
                }
                return { block, proposalManager, targets: [...targets] };
              }
            : skipToken,
        refetchOnMount: ({ state }) => state.status !== "error",
        refetchInterval: ({ state }) => (state.status === "error" ? 5 * 60_000 : false),
        retryOnMount: false,
      }),
    ),
    combine: useCallback(
      (results: UseQueryResult<null | { targets: readonly string[] }>[]): Allowlists =>
        Object.fromEntries(
          snapshot.map(([id, fallback]) => {
            const targets = results[chains.indexOf(id)]?.data?.targets;
            if (!targets) return [id, fallback];
            let set = sets.get(targets);
            if (!set) {
              set = new Set(targets);
              sets.set(targets, set);
            }
            return [id, set];
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
const sets = new WeakMap<readonly string[], ReadonlySet<string>>();

type Allowlist = { block: bigint; proposalManager: Address; targets: readonly string[] };
