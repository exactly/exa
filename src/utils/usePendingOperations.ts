import { useCallback, useMemo } from "react";

import { useMutationState } from "@tanstack/react-query";
import { encodeDeployData } from "viem";
import { useBytecode, useReadContract } from "wagmi";

import chain, {
  auditorAddress,
  exaPreviewerAbi,
  exaPreviewerCode,
  marketUSDCAddress,
  proposalManagerAddress,
} from "@exactly/common/generated/chain";
import ProposalType, {
  decodeCrossRepayAtMaturity,
  decodeRepayAtMaturity,
  decodeRollDebt,
} from "@exactly/common/ProposalType";

import useAccount from "./useAccount";
import exa from "./wagmi/exa";

import type { RouteFrom } from "./lifi";
import type { MutationState } from "@tanstack/react-query";
import type { Address } from "viem";

export default function usePendingOperations() {
  const { address: exaAccount } = useAccount({ config: exa });
  const { data: bytecode } = useBytecode({ address: exaAccount, chainId: chain.id, query: { enabled: !!exaAccount } });

  const proposals = useReadContract({
    abi: exaPreviewerAbi,
    functionName: "pendingProposals",
    code: encodeDeployData({
      abi: exaPreviewerAbi,
      bytecode: exaPreviewerCode,
      args: [auditorAddress, marketUSDCAddress, proposalManagerAddress],
    }),
    chainId: chain.id,
    args: exaAccount ? [exaAccount] : undefined,
    query: { enabled: !!exaAccount && !!bytecode, gcTime: 0, refetchInterval: 30_000 },
  });

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
    (market: Address, maturity: bigint) => {
      if (!proposals.data) return false;
      return proposals.data.some(({ proposal }) => {
        const { proposalType: type, data } = proposal;
        if (type === (ProposalType.RepayAtMaturity as number)) {
          return proposal.market === market && decodeRepayAtMaturity(data).maturity === maturity;
        }
        if (type === (ProposalType.CrossRepayAtMaturity as number)) {
          const decoded = decodeCrossRepayAtMaturity(data);
          return (decoded.marketOut ?? marketUSDCAddress) === market && decoded.maturity === maturity;
        }
        if (type === (ProposalType.RollDebt as number)) {
          return proposal.market === market && decodeRollDebt(data).repayMaturity === maturity;
        }
        return false;
      });
    },
    [proposals.data],
  );

  return { count: (proposals.data?.length ?? 0) + mutations.length, isProcessing, mutations, proposals };
}
