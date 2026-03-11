import { useCallback, useMemo } from "react";

import { useMutationState } from "@tanstack/react-query";
import { useBytecode } from "wagmi";

import chain, { exaPreviewerAddress } from "@exactly/common/generated/chain";
import { useReadExaPreviewerPendingProposals } from "@exactly/common/generated/hooks";
import ProposalType, {
  decodeCrossRepayAtMaturity,
  decodeRepayAtMaturity,
  decodeRollDebt,
} from "@exactly/common/ProposalType";

import useAccount from "./useAccount";
import exa from "./wagmi/exa";

import type { RouteFrom } from "./lifi";
import type { MutationState } from "@tanstack/react-query";

export default function usePendingOperations() {
  const { address: exaAccount } = useAccount({ config: exa });
  const { data: bytecode } = useBytecode({ address: exaAccount, chainId: chain.id, query: { enabled: !!exaAccount } });

  const proposals = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
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
    (maturity: bigint) => {
      if (!proposals.data) return false;
      return proposals.data.some(({ proposal }) => {
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

  return { count: (proposals.data?.length ?? 0) + mutations.length, isProcessing, mutations, proposals };
}
