import { useMemo } from "react";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
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
  const { market, timestamp, firstMaturity } = useAsset(marketAddress);
  const now = Number(timestamp);

  return useMemo(() => {
    const isLoading = !market;
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
  }, [market, firstMaturity, now, installments, totalAmount]);
}
