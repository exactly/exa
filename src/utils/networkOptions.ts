import { queryOptions, skipToken } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";
import { decodeFunctionResult, getContractAddress, isAddress, zeroAddress, zeroHash } from "viem";

import {
  allowlists,
  appPreviewerAbi,
  appPreviewerCode,
  appPreviewerDeployedCode,
  chains,
  previewerAbi,
} from "@exactly/common/generated/chain";
import { ratePreviewerAbi } from "@exactly/common/generated/hooks";

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
          const contracts = chains.get(chainId);
          const preview = await readContract(exaConfig, {
            chainId,
            abi: appPreviewerAbi,
            address: previewerAddress,
            functionName: "preview",
            args: [
              account,
              contracts?.auditor ?? zeroAddress,
              contracts?.previewer ?? zeroAddress,
              contracts?.ratePreviewer ?? zeroAddress,
              contracts?.marketUSDC ?? zeroAddress,
              targets,
            ],
            stateOverride: [{ address: previewerAddress, code: appPreviewerDeployedCode }],
          });
          return {
            allowlist:
              preview.proposalManager.proposalManager === zeroAddress
                ? null
                : targets.filter((_, index) => preview.allowed[index]),
            lifi: tokens !== undefined,
            timestamp: preview.timestamp,
            ...(contracts && {
              markets: withPreviews(
                decodeFunctionResult({ abi: previewerAbi, functionName: "exactly", data: preview.exactly }),
                preview.markets,
              ).map((market) => ({ ...market, chainId })),
              snapshot:
                preview.snapshot === "0x"
                  ? undefined
                  : decodeFunctionResult({ abi: ratePreviewerAbi, functionName: "snapshot", data: preview.snapshot }),
              floatingAssetsAverage: preview.floatingAssetsAverage,
            }),
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

function withPreviews<T extends { isCollateral: boolean; market: Address }>(
  markets: readonly T[],
  previews: readonly { isFrozen: boolean; market: Address; nonCollateral: boolean }[],
) {
  return markets.map((market) => {
    const preview = previews.find(({ market: address }) => address === market.market);
    return {
      ...market,
      isCollateral: market.isCollateral && !preview?.nonCollateral,
      isFrozen: !!preview?.isFrozen,
      nonCollateral: !!preview?.nonCollateral,
    };
  });
}

export function marketWETH(chainId: number) {
  return chains.get(chainId)?.marketWETH;
}

export function network(chainId: number) {
  const found = chains.get(chainId);
  if (!found) throw new Error(`unknown network ${chainId}`);
  return found;
}
