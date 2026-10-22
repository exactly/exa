import { queryOptions, skipToken } from "@tanstack/react-query";
import { readContract, readContracts } from "@wagmi/core/actions";

import { exaAccountFactoryAbi, exaPluginAbi, upgradeableModularAccountAbi } from "@exactly/common/generated/chain";

import deployedOptions from "./deployedOptions";
import queryClient from "./queryClient";
import exaConfig from "./wagmi/exa";

import type { Address } from "viem";

export default function pluginOptions(account: Address | undefined, factory: Address | undefined, chainId: number) {
  return queryOptions({
    queryKey: ["plugin", account, factory, chainId],
    staleTime: 5 * 60_000,
    gcTime: Infinity,
    queryFn:
      account && factory
        ? async (): Promise<null | { address: Address; version: string }> => {
            const plugins = (await queryClient.ensureQueryData(deployedOptions(account, chainId)))
              ? await readContract(exaConfig, {
                  chainId,
                  address: account,
                  abi: upgradeableModularAccountAbi,
                  functionName: "getInstalledPlugins",
                })
              : (await queryClient.ensureQueryData(deployedOptions(factory, chainId)))
                ? [
                    await readContract(exaConfig, {
                      chainId,
                      address: factory,
                      abi: exaAccountFactoryAbi,
                      functionName: "EXA_PLUGIN",
                    }),
                  ]
                : [];
            const metadata = await readContracts(exaConfig, {
              allowFailure: true,
              contracts: plugins.map(
                (address) => ({ chainId, address, abi: exaPluginAbi, functionName: "pluginMetadata" }) as const,
              ),
            });
            for (const [index, address] of plugins.entries()) {
              const result = metadata[index]?.result;
              if (result?.name === "Exa Plugin") return { address, version: result.version };
            }
            return null;
          }
        : skipToken,
    refetchOnMount: ({ state }) => state.status !== "error",
  });
}
