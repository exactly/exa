import { useMemo } from "react";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import { fixedUtilization, globalUtilization, MATURITY_INTERVAL, splitInstallments } from "@exactly/lib";

import reportError from "./reportError";
import useAsset from "./useAsset";

import type { Hex } from "@exactly/common/validation";

export default function useInstallments({
  totalAmount,
  installments,
  marketAddress = marketUSDCAddress,
}: {
  installments: number;
  marketAddress?: Hex;
  totalAmount: bigint;
}) {
  const { market, timestamp } = useAsset(marketAddress);
  const now = Number(timestamp);

  return useMemo(() => {
    const isLoading = !market;
    const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    const firstMaturity = nextMaturity - now < MIN_BORROW_INTERVAL ? nextMaturity + MATURITY_INTERVAL : nextMaturity;
    let data: ReturnType<typeof splitInstallments> | undefined;

    try {
      if (market && totalAmount > 0n && installments > 1) {
        data = splitInstallments(
          totalAmount,
          market.totalFloatingDepositAssets,
          firstMaturity,
          market.fixedPools.length,
          market.fixedPools
            .filter(
              ({ maturity }) =>
                maturity >= firstMaturity && maturity < firstMaturity + installments * MATURITY_INTERVAL,
            )
            .map(({ supplied, borrowed }) => fixedUtilization(supplied, borrowed, market.totalFloatingDepositAssets)),
          market.floatingUtilization,
          globalUtilization(
            market.totalFloatingDepositAssets,
            market.totalFloatingBorrowAssets,
            market.floatingBackupBorrowed,
          ),
          market.interestRateModel.parameters,
          now,
        );
      }
    } catch (error) {
      reportError(error);
    }

    return {
      data,
      firstMaturity,
      isFetching: isLoading || (installments > 1 && !data && totalAmount > 0n),
    };
  }, [market, now, installments, totalAmount]);
}
