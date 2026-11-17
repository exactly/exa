import { queryOptions, skipToken } from "@tanstack/react-query";
import { readContract, readContracts } from "@wagmi/core/actions";
import { multicall3Abi, zeroAddress } from "viem";

import { alchemyChains, appPreviewerAbi, appPreviewerCode, chains } from "@exactly/common/generated/chain";
import { ratePreviewerAbi } from "@exactly/common/generated/hooks";

import { protocolOf, withFlags } from "./networkOptions";
import exaConfig from "./wagmi/exa";

import type { Address } from "viem";

export default function marketsOptions(account: Address | undefined, chainId: number) {
  return queryOptions({
    queryKey: ["markets", account, chainId],
    staleTime: 10_000,
    queryFn: account
      ? async () => {
          const { protocol } = await readContract(exaConfig, {
            chainId,
            abi: appPreviewerAbi,
            functionName: "preview",
            code: appPreviewerCode,
            args: [account, [], { ...protocolOf(chainId), ratePreviewer: zeroAddress }],
          });
          return protocol.markets.map((row) => ({ ...withFlags(row.market, row), chainId }));
        }
      : skipToken,
  });
}

export function ratesOptions(chainId: number) {
  return queryOptions({
    queryKey: ["rates", chainId],
    staleTime: 10_000,
    refetchInterval: ({ state }) => (state.status === "error" ? 60_000 : false),
    queryFn: async () => {
      const contracts = network(chainId);
      return readContracts(exaConfig, {
        allowFailure: false,
        contracts: [
          { chainId, address: contracts.ratePreviewer, abi: ratePreviewerAbi, functionName: "snapshot" },
          { chainId, address: contracts.multicall3, abi: multicall3Abi, functionName: "getCurrentBlockTimestamp" },
        ],
      });
    },
  });
}

export function network(chainId: number) {
  const found = chains.get(chainId);
  const multicall3 = alchemyChains.get(chainId)?.contracts?.multicall3?.address;
  if (!found || !multicall3) throw new Error(`unknown network ${chainId}`);
  return { ...found, multicall3 };
}
