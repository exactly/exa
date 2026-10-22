import { queryOptions, skipToken } from "@tanstack/react-query";
import { getBlock, getContractEvents, readContract } from "@wagmi/core/actions";
import { zeroAddress, type Address } from "viem";

import chain, { appPreviewerAbi, appPreviewerCode, proposalManagerAbi } from "@exactly/common/generated/chain";

import queryClient from "./queryClient";
import exaConfig from "./wagmi/exa";

export default function allowlistOptions(account: Address | undefined, chainId: number) {
  return queryOptions({
    queryKey: ["allowlist", chainId, account],
    staleTime: 5 * 60_000,
    gcTime: Infinity,
    queryFn:
      account && !chain.testnet
        ? async ({ queryKey }): Promise<Allowlist | null> => {
            const { proposalManager } = await readContract(exaConfig, {
              chainId,
              abi: appPreviewerAbi,
              functionName: "proposalManager",
              code: appPreviewerCode,
              args: [account],
            });
            if (proposalManager === zeroAddress) return null;
            const { number: block } = await getBlock(exaConfig, { chainId, blockTag: "safe" });
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
    retryOnMount: false,
  });
}

type Allowlist = { block: bigint; proposalManager: Address; targets: readonly string[] };
