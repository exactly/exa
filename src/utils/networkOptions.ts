import { queryOptions, skipToken } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";
import { getContractAddress, isAddress, zeroAddress, zeroHash } from "viem";

import {
  allowlists,
  appPreviewerAbi,
  appPreviewerCode,
  appPreviewerDeployedCode,
} from "@exactly/common/generated/chain";

import { lifiTokensOptions } from "./lifi";
import queryClient from "./queryClient";
import exaConfig from "./wagmi/exa";

import type { Address } from "viem";

export default function networkOptions(account: Address | undefined, chainId: number) {
  return queryOptions({
    queryKey: ["network", chainId, account],
    queryFn: account
      ? async () => {
          const tokens = queryClient.getQueryData(lifiTokensOptions.queryKey);
          const targets = [
            ...new Set(
              [
                ...(allowlists[chainId] ?? []),
                ...(tokens ?? [])
                  .filter(
                    (token) => (token.chainId as number) === chainId && isAddress(token.address, { strict: false }),
                  )
                  .map(({ address }) => address),
              ].map((target) => target.toLowerCase() as Address),
            ),
          ];
          const { proposalManager, allowed } = await readContract(exaConfig, {
            chainId,
            abi: appPreviewerAbi,
            address: previewerAddress,
            functionName: "preview",
            args: [account, zeroAddress, zeroAddress, zeroAddress, zeroAddress, targets],
            stateOverride: [{ address: previewerAddress, code: appPreviewerDeployedCode }],
          });
          return {
            allowlist:
              proposalManager.proposalManager === zeroAddress ? null : targets.filter((_, index) => allowed[index]),
            lifi: tokens !== undefined,
          };
        }
      : skipToken,
    staleTime: 10_000,
    gcTime: Infinity,
    refetchInterval: ({ state }) => (state.status === "error" ? 60_000 : false),
  });
}

const previewerAddress = getContractAddress({
  bytecode: appPreviewerCode,
  from: zeroAddress,
  opcode: "CREATE2",
  salt: zeroHash,
});
