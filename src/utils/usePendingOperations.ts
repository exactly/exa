import { useCallback, useMemo } from "react";

import { queryOptions, skipToken, useMutationState, useQueries } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";

import chain, { appPreviewerAbi, appPreviewerCode, chains } from "@exactly/common/generated/chain";
import ProposalType, {
  decodeCrossRepayAtMaturity,
  decodeRepayAtMaturity,
  decodeRollDebt,
} from "@exactly/common/ProposalType";

import useAccount from "./useAccount";
import exa from "./wagmi/exa";

import type { RouteFrom } from "./lifi";
import type { MutationState, UseQueryResult } from "@tanstack/react-query";
import type { Address } from "viem";

export default function usePendingOperations() {
  const { address: exaAccount } = useAccount({ config: exa });
  const proposals = useQueries({ queries: chainIds.map((chainId) => proposalsOptions(exaAccount, chainId)), combine });

  const [bridgeMutation] = useMutationState<MutationState<unknown, Error, RouteFrom> & { id: number }>({
    filters: { mutationKey: ["bridge", "execute"], exact: true },
    select: ({ state, mutationId }) => {
      return { ...state, id: mutationId, variables: state.variables as RouteFrom };
    },
  });

  const mutations = useMemo(() => {
    // TODO add other pending mutations if needed
    return [...(bridgeMutation?.status === "pending" ? [bridgeMutation] : [])];
  }, [bridgeMutation]);

  const isProcessing = useCallback(
    (maturity: bigint, chainId = chain.id) => {
      return proposals.data.some(({ chainId: proposalChainId, proposal }) => {
        if (proposalChainId !== chainId) return false;
        const { proposalType: type, data } = proposal;
        if (
          type === (ProposalType.RepayAtMaturity as number) ||
          type === (ProposalType.CrossRepayAtMaturity as number)
        ) {
          const decoded =
            type === (ProposalType.RepayAtMaturity as number)
              ? decodeRepayAtMaturity(data)
              : decodeCrossRepayAtMaturity(data);
          return decoded.maturity === maturity;
        }
        if (type === (ProposalType.RollDebt as number)) return decodeRollDebt(data).repayMaturity === maturity;
        return false;
      });
    },
    [proposals.data],
  );

  return { count: proposals.data.length + mutations.length, isProcessing, mutations, proposals };
}

function proposalsOptions(account: Address | undefined, chainId: number) {
  return queryOptions({
    queryKey: ["proposals", account, chainId],
    queryFn: account ? () => pendingProposals(account, chainId) : skipToken,
    gcTime: 0,
  });
}

async function pendingProposals(account: Address, chainId: number) {
  const pending = await readContract(exa, {
    chainId,
    abi: appPreviewerAbi,
    functionName: "pendingProposals",
    code: appPreviewerCode,
    args: [account],
  });
  return pending.map((proposal) => ({ ...proposal, chainId }));
}

function combine(results: UseQueryResult<Awaited<ReturnType<typeof pendingProposals>>>[]) {
  return {
    data: results.flatMap(({ data }) => data ?? []),
    isFetching: results.some(({ isFetching }) => isFetching),
    isPendingOn: (chainId: number) => results[chainIds.indexOf(chainId)]?.isPending ?? false,
    refetch: () => Promise.all(results.map(({ refetch }) => refetch())),
  };
}

const chainIds = [chain.id, ...[...chains.keys()].filter((id) => id !== chain.id)];
