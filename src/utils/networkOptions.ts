import { queryOptions, skipToken } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";
import { getContractAddress, isAddress, zeroAddress, zeroHash } from "viem";

import {
  allowlists,
  appPreviewerAbi,
  appPreviewerCode,
  appPreviewerDeployedCode,
  chains,
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
              protocolOf(chainId),
            ],
            stateOverride: [{ address: appPreviewerAddress, code: appPreviewerDeployedCode }],
          });
          return {
            allowlist:
              wallet.proposalManager.proposalManager === zeroAddress
                ? null
                : wallet.allowed.map((target) => target.toLowerCase()),
            collateral: protocol.markets
              .filter(({ isFrozen, nonCollateral }) => !isFrozen && !nonCollateral)
              .flatMap(({ market: { asset, symbol } }) => [
                asset.toLowerCase(),
                ...(symbol === "exaWETH" ? [zeroAddress] : []),
              ]),
            lifi: tokens !== undefined,
            timestamp: wallet.timestamp,
            balance: wallet.balance,
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

export function withFlags<T extends { isCollateral: boolean }>(
  market: T,
  flags: undefined | { isFrozen: boolean; nonCollateral: boolean },
) {
  return {
    ...market,
    isCollateral: market.isCollateral && !flags?.nonCollateral,
    isFrozen: !!flags?.isFrozen,
    nonCollateral: !!flags?.nonCollateral,
  };
}

export function protocolOf(chainId: number) {
  const contracts = chains.get(chainId);
  if (!contracts) return { auditor: zeroAddress, previewer: zeroAddress, ratePreviewer: zeroAddress };
  return { auditor: contracts.auditor, previewer: contracts.previewer, ratePreviewer: contracts.ratePreviewer };
}

const appPreviewerAddress = getContractAddress({
  bytecode: appPreviewerCode,
  from: zeroAddress,
  opcode: "CREATE2",
  salt: zeroHash,
});
