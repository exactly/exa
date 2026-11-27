import { queryOptions, skipToken } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";
import { getAbiItem, toFunctionSelector, zeroAddress, type Address } from "viem";
import { base, optimism } from "viem/chains";

import chain from "@exactly/common/generated/chain";
import { exaPluginAbi, upgradeableModularAccountAbi } from "@exactly/common/generated/hooks";

import exaConfig from "./wagmi/exa";

export default function exaOptions(address: Address | undefined) {
  return queryOptions({
    queryKey: ["exa", address],
    queryFn: address
      ? async () => {
          const found = await Promise.all(
            (chain.testnet ? [chain.id] : [optimism.id, base.id]).flatMap((chainId) =>
              [getAbiItem({ abi: exaPluginAbi, name: "collectDebit" }), "enterMarket(address)"].map((item) =>
                readContract(exaConfig, {
                  address,
                  chainId,
                  abi: upgradeableModularAccountAbi,
                  functionName: "getExecutionFunctionConfig",
                  args: [toFunctionSelector(item)],
                }).then(
                  ({ plugin }) => plugin !== zeroAddress,
                  () => false,
                ),
              ),
            ),
          );
          return found.includes(true);
        }
      : skipToken,
    staleTime: (query) => (query.state.data ? Infinity : 0),
    gcTime: Infinity,
  });
}
