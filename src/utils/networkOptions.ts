import { queryOptions, skipToken } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";
import { getContractAddress, isAddress, zeroAddress, zeroHash } from "viem";

import chain, {
  allowlists,
  appPreviewerAbi,
  appPreviewerCode,
  appPreviewerDeployedCode,
  auditorAddress,
  previewerAddress,
  ratePreviewerAddress,
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
          const { wallet, protocol } = await readContract(exaConfig, {
            chainId,
            abi: appPreviewerAbi,
            address: appPreviewerAddress,
            functionName: "preview",
            args: [
              account,
              [
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
              ],
              chainId === chain.id
                ? { auditor: auditorAddress, previewer: previewerAddress, ratePreviewer: ratePreviewerAddress }
                : { auditor: zeroAddress, previewer: zeroAddress, ratePreviewer: zeroAddress },
            ],
            stateOverride: [{ address: appPreviewerAddress, code: appPreviewerDeployedCode }],
          });
          return {
            allowlist:
              wallet.proposalManager.proposalManager === zeroAddress
                ? null
                : wallet.allowed.map((target) => target.toLowerCase()),
            lifi: tokens !== undefined,
            timestamp: wallet.timestamp,
            markets: protocol.markets,
            rates: protocol.rates,
          };
        }
      : skipToken,
    staleTime: 10_000,
    gcTime: Infinity,
    refetchInterval: ({ state }) => (state.status === "error" ? 60_000 : false),
  });
}

const appPreviewerAddress = getContractAddress({
  bytecode: appPreviewerCode,
  from: zeroAddress,
  opcode: "CREATE2",
  salt: zeroHash,
});
