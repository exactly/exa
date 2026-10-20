import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";
import { useReadContract } from "wagmi";

import accountInit from "@exactly/common/accountInit";
import chain, { marketUSDCAddress } from "@exactly/common/generated/chain";
import { exaPluginAbi, useReadUpgradeableModularAccountGetInstalledPlugins } from "@exactly/common/generated/hooks";
import { WAD } from "@exactly/lib";

import useAccount from "./useAccount";
import useMarkets from "./useMarkets";

import type { Credential } from "@exactly/common/validation";

export default function useLoanMarkets() {
  const { address } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { markets } = useMarkets();
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    chainId: chain.id,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: { enabled: !!address && !!credential },
  });
  const { data: anyMarket } = useReadContract({
    address: installedPlugins?.[0],
    abi: exaPluginAbi,
    functionName: "pluginMetadata",
    chainId: chain.id,
    query: {
      enabled: !!installedPlugins?.[0],
      select: ({ version }) => {
        const [major = 0, minor = 0] = version.split(".").map(Number);
        return major > 1 || (major === 1 && minor >= 1);
      },
    },
  });
  return useMemo(
    () =>
      markets && anyMarket !== undefined
        ? markets
            .filter(
              ({ market, symbol, fixedPools, reserveFactor, isFrozen }) =>
                ["USDC", "wARS"].includes(symbol.slice(3)) &&
                fixedPools.length > 0 &&
                reserveFactor < WAD &&
                !isFrozen &&
                (anyMarket || market === marketUSDCAddress),
            )
            .map(({ market }) => market)
        : undefined,
    [markets, anyMarket],
  );
}
