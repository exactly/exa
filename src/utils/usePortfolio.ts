import { useMemo } from "react";

import { zeroAddress } from "viem";

import { useReadPreviewerExactly, useReadRatePreviewerSnapshot } from "@exactly/common/generated/hooks";
import { floatingDepositRates } from "@exactly/lib";

import type { Hex } from "@exactly/common/validation";

export default function usePortfolio(account?: Hex) {
  const { data: rateSnapshot, dataUpdatedAt: rateDataUpdatedAt } = useReadRatePreviewerSnapshot();
  const { data: markets } = useReadPreviewerExactly({ args: [account ?? zeroAddress] });

  const portfolio = useMemo(() => {
    if (!markets) return { depositMarkets: [], usdBalance: 0n };

    const depositMarkets: { market: string; symbol: string; usdValue: bigint }[] = [];
    let usdBalance = 0n;
    for (const { floatingDepositAssets, usdPrice, decimals, market, symbol } of markets) {
      if (floatingDepositAssets <= 0n) continue;
      const usdValue = (floatingDepositAssets * usdPrice) / 10n ** BigInt(decimals);
      if (usdValue <= 0n) continue;
      depositMarkets.push({ market, symbol: symbol.slice(3) === "WETH" ? "ETH" : symbol.slice(3), usdValue });
      usdBalance += usdValue;
    }

    return { usdBalance, depositMarkets } as const;
  }, [markets]);

  const rates = useMemo(
    () => (rateSnapshot ? floatingDepositRates(rateSnapshot, Math.floor(rateDataUpdatedAt / 1000)) : []),
    [rateSnapshot, rateDataUpdatedAt],
  );

  const averageRate = useMemo(() => {
    const { depositMarkets, usdBalance } = portfolio;
    if (depositMarkets.length === 0 || usdBalance === 0n || rates.length === 0) return 0n;
    const rateByMarket = new Map(rates.map(({ market, rate }) => [market, rate]));

    let weightedRate = 0n;
    for (const { market, usdValue } of depositMarkets) {
      const rate = rateByMarket.get(market);
      if (rate === undefined || usdValue <= 0n) continue;
      weightedRate += rate * usdValue;
    }

    return weightedRate / usdBalance;
  }, [portfolio, rates]);

  return { portfolio, averageRate };
}
