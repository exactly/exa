import { useMemo } from "react";

import chain, { marketUSDCAddress } from "@exactly/common/generated/chain";
import { borrowLimit, withdrawLimit } from "@exactly/lib";

import { network } from "./networkOptions";
import { useNetworkMarkets } from "./useDeposits";

export default function useCardFunds() {
  const { markets } = useNetworkMarkets();
  return useMemo(() => {
    let collateral = 0n;
    let credit = 0n;
    let spending = 0n;
    for (const [chainId, data] of markets) {
      if (!data) continue;
      const usdc = chainId === chain.id ? marketUSDCAddress : network(chainId).marketUSDC;
      credit += borrowLimit(data, usdc);
      spending += withdrawLimit(data, usdc);
      for (const { decimals, floatingDepositAssets, nonCollateral, usdPrice } of data) {
        if (nonCollateral || floatingDepositAssets <= 0n) continue;
        collateral += (floatingDepositAssets * usdPrice) / 10n ** BigInt(decimals);
      }
    }
    return { collateral, credit, spending };
  }, [markets]);
}
