import { queryOptions, skipToken } from "@tanstack/react-query";
import { getAbiItem } from "viem";
import { getLogs } from "viem/actions";

import { proposalManagerAbi } from "@exactly/common/generated/hooks";

import exaConfig from "./wagmi/exa";

import type { Address } from "viem";

export default function executionOptions(
  chainId: number,
  account?: Address,
  proposalManager?: Address,
  nonce?: bigint,
  since?: bigint,
) {
  return queryOptions({
    queryKey: ["proposal", "execution", chainId, account, proposalManager, String(nonce), String(since)],
    retry: false,
    meta: { warnError: () => true },
    queryFn:
      account && proposalManager && nonce !== undefined && since !== undefined
        ? async () => {
            const [log] = await getLogs(exaConfig.getClient({ chainId }), {
              address: proposalManager,
              event: getAbiItem({ abi: proposalManagerAbi, name: "ProposalNonceSet" }),
              args: { account, nonce: nonce + 1n },
              fromBlock: since,
              toBlock: "latest",
            });
            return log ? { executed: !!log.args.executed, hash: log.transactionHash } : null;
          }
        : skipToken,
    refetchInterval: ({ state }) =>
      state.data || state.dataUpdateCount + state.errorUpdateCount >= 240 ? false : 5000,
  });
}
