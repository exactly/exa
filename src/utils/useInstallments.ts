import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import { marketUSDCAddress } from "@exactly/common/generated/chain";
import { fixedUtilization, globalUtilization, MATURITY_INTERVAL, splitInstallments } from "@exactly/lib";
import { useMemo } from "react";

import useAsset from "./useAsset";

export default function useInstallments({ totalAmount, installments }: { totalAmount: bigint; installments: number }) {
  const { market } = useAsset(marketUSDCAddress);

  return useMemo(() => {
    const isLoading = !market;

    const timestamp = Math.floor(Date.now() / 1000);
    const nextMaturity = timestamp - (timestamp % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    const firstMaturity =
      nextMaturity - timestamp < MIN_BORROW_INTERVAL ? nextMaturity + MATURITY_INTERVAL : nextMaturity;

    let data: ReturnType<typeof splitInstallments> | undefined;
    if (market && totalAmount > 0n && installments > 1) {
      data = splitInstallments(
        totalAmount,
        market.totalFloatingDepositAssets,
        firstMaturity,
        market.fixedPools.length,
        market.fixedPools
          .filter(
            ({ maturity }) => maturity >= firstMaturity && maturity < firstMaturity + installments * MATURITY_INTERVAL,
          )
          .map(({ supplied, borrowed }) => fixedUtilization(supplied, borrowed, market.totalFloatingDepositAssets)),
        market.floatingUtilization,
        globalUtilization(
          market.totalFloatingDepositAssets,
          market.totalFloatingBorrowAssets,
          market.floatingBackupBorrowed,
        ),
        market.interestRateModel.parameters,
      );
    }

    return {
      data,
      firstMaturity,
      timestamp,
      isFetching: isLoading || (installments > 1 && !data && totalAmount > 0n),
    };
  }, [market, totalAmount, installments]);
}
