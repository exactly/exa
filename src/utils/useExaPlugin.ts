import { useQuery } from "@tanstack/react-query";
import { getAbiItem, toFunctionSelector, zeroAddress } from "viem";

import accountInit from "@exactly/common/accountInit";
import {
  exaPluginAbi,
  useReadUpgradeableModularAccountGetExecutionFunctionConfig,
} from "@exactly/common/generated/hooks";

import useAccount from "./useAccount";

import type { Credential } from "@exactly/common/validation";

export default function useExaPlugin(chainId: number, staleTime?: number) {
  const { address } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const account = {
    address,
    chainId,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
  };
  const {
    data: config,
    errorUpdateCount: configErrors,
    refetch,
  } = useReadUpgradeableModularAccountGetExecutionFunctionConfig({
    ...account,
    args: [collectDebit],
    query: {
      enabled: !!address && !!credential,
      staleTime,
      refetchInterval: ({ state }) => (state.error ? 20_000 : false),
    },
  });
  const { data: legacy, errorUpdateCount: legacyErrors } = useReadUpgradeableModularAccountGetExecutionFunctionConfig({
    ...account,
    args: [enterMarket],
    query: {
      enabled: config?.plugin === zeroAddress,
      staleTime,
      refetchInterval: ({ state }) => (state.error ? 20_000 : false),
    },
  });
  const plugin = config?.plugin === zeroAddress ? legacy?.plugin : config?.plugin;
  return {
    plugin: plugin === zeroAddress ? undefined : plugin,
    failed: plugin === undefined && (config === undefined ? configErrors > 0 : legacyErrors > 0),
    refetch,
  };
}

export const collectDebit = toFunctionSelector(getAbiItem({ abi: exaPluginAbi, name: "collectDebit" }));
export const enterMarket = toFunctionSelector("enterMarket(address)");
