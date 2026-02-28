import { useMemo } from "react";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import {
  fixedRate,
  fixedUtilization,
  globalUtilization,
  MATURITY_INTERVAL,
  ONE_YEAR,
  splitInstallments,
  WAD,
} from "@exactly/lib";

import reportError from "./reportError";
import useAsset from "./useAsset";

export default function useInstallmentRates(amount = 100_000_000n) {
  const { market } = useAsset(marketUSDCAddress);
  return useMemo(() => {
    if (!market) return;
    const now = Math.floor(Date.now() / 1000);
    const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    const firstMaturity = nextMaturity - now < MIN_BORROW_INTERVAL ? nextMaturity + MATURITY_INTERVAL : nextMaturity;
    if (amount <= 0n) {
      const installments = [];
      for (let count = 1; count <= MAX_INSTALLMENTS; count++) {
        installments.push({ count, payments: Array.from<bigint>({ length: count }).fill(0n), rate: 0n, total: 0n });
      }
      return { installments, firstMaturity };
    }
    const {
      fixedPools,
      floatingBackupBorrowed,
      floatingUtilization,
      interestRateModel: { parameters },
      totalFloatingBorrowAssets,
      totalFloatingDepositAssets,
    } = market;
    const marketUtilization = globalUtilization(
      totalFloatingDepositAssets,
      totalFloatingBorrowAssets,
      floatingBackupBorrowed,
    );
    const borrowImpact = totalFloatingDepositAssets > 0n ? (amount * WAD - 1n) / totalFloatingDepositAssets + 1n : 0n;
    try {
      const installments = [];
      for (let count = 1; count <= MAX_INSTALLMENTS; count++) {
        const poolUtilizations = fixedPools
          .filter(({ maturity }) => maturity >= firstMaturity && maturity < firstMaturity + count * MATURITY_INTERVAL)
          .map(({ supplied, borrowed }) => fixedUtilization(supplied, borrowed, totalFloatingDepositAssets));
        if (poolUtilizations.length === 0) {
          installments.push({ count, payments: undefined, rate: 0n, total: 0n });
          continue;
        }
        if (count === 1) {
          const rate = fixedRate(
            firstMaturity,
            fixedPools.length,
            (poolUtilizations[0] ?? 0n) + borrowImpact,
            floatingUtilization,
            marketUtilization + borrowImpact,
            parameters,
            now,
          );
          const fee = (amount * rate * BigInt(firstMaturity - now)) / (WAD * ONE_YEAR);
          const total = amount + fee;
          installments.push({ count, payments: [total], rate, total });
          continue;
        }
        const { installments: payments, effectiveRate } = splitInstallments(
          amount,
          totalFloatingDepositAssets,
          firstMaturity,
          fixedPools.length,
          poolUtilizations,
          floatingUtilization,
          marketUtilization,
          parameters,
          now,
        );
        installments.push({ count, payments, rate: effectiveRate, total: payments.reduce((a, b) => a + b, 0n) });
      }
      return { installments, firstMaturity };
    } catch (error) {
      reportError(error);
    }
  }, [market, amount]);
}
