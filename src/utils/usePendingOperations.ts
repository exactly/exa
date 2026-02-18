import { useMemo } from "react";

import { useMutationState } from "@tanstack/react-query";
import { useBytecode } from "wagmi";

import { exaPreviewerAddress } from "@exactly/common/generated/chain";
import { useReadExaPreviewerPendingProposals } from "@exactly/common/generated/hooks";

import useAccount from "./useAccount";
import exa from "./wagmi/exa";

import type { RouteFrom } from "./lifi";
import type { MutationState } from "@tanstack/react-query";

export default function usePendingOperations() {
  const { address: exaAccount } = useAccount({ config: exa });
  const { data: bytecode } = useBytecode({ address: exaAccount, query: { enabled: !!exaAccount } });

  const proposals = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
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

  return { count: (proposals.data?.length ?? 0) + mutations.length, mutations, proposals };
}
