import { useMemo } from "react";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import {
  fixedRate,
  fixedUtilization,
  globalUtilization,
  MATURITY_INTERVAL,
  splitInstallments,
  WAD,
} from "@exactly/lib";

import reportError from "./reportError";
import useAsset from "./useAsset";

const AMOUNT = 100_000_000n;

export default function useInstallmentRates() {
  const { market } = useAsset(marketUSDCAddress);
  return useMemo(() => {
    if (!market) return;
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const nextMaturity = timestamp - (timestamp % MATURITY_INTERVAL) + MATURITY_INTERVAL;
      const firstMaturity =
        nextMaturity - timestamp < MIN_BORROW_INTERVAL ? nextMaturity + MATURITY_INTERVAL : nextMaturity;
      const { fixedPools, floatingUtilization, totalFloatingDepositAssets, totalFloatingBorrowAssets } = market;
      const { floatingBackupBorrowed, interestRateModel } = market;
      const uGlobal = globalUtilization(totalFloatingDepositAssets, totalFloatingBorrowAssets, floatingBackupBorrowed);
      const { parameters } = interestRateModel;
      const result: bigint[] = [];
      const borrowImpact = totalFloatingDepositAssets > 0n ? (AMOUNT * WAD - 1n) / totalFloatingDepositAssets + 1n : 0n;
      const uFixed1 =
        fixedPools
          .filter(({ maturity }) => maturity >= firstMaturity && maturity < firstMaturity + MATURITY_INTERVAL)
          .map(({ supplied, borrowed }) => fixedUtilization(supplied, borrowed, totalFloatingDepositAssets))[0] ?? 0n;
      result.push(
        fixedRate(
          firstMaturity,
          fixedPools.length,
          uFixed1 + borrowImpact,
          floatingUtilization,
          uGlobal + borrowImpact,
          parameters,
          timestamp,
        ),
      );
      for (let count = 2; count <= MAX_INSTALLMENTS; count++) {
        const uFixed = fixedPools
          .filter(({ maturity }) => maturity >= firstMaturity && maturity < firstMaturity + count * MATURITY_INTERVAL)
          .map(({ supplied, borrowed }) => fixedUtilization(supplied, borrowed, totalFloatingDepositAssets));
        result.push(
          splitInstallments(
            AMOUNT,
            totalFloatingDepositAssets,
            firstMaturity,
            fixedPools.length,
            uFixed,
            floatingUtilization,
            uGlobal,
            parameters,
            timestamp,
          ).effectiveRate,
        );
      }
      return result;
    } catch (error) {
      reportError(error);
    }
  }, [market]);
}
