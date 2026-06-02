import { useMemo } from "react";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
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
import useMarkets from "./useMarkets";

export default function useInstallmentRates(amount = 100_000_000n) {
  const { markets, timestamp, firstMaturity, floatingAssetsAverage } = useMarkets();
  const market = markets?.find(({ market: address }) => address === marketUSDCAddress);
  const now = Number(timestamp);
  return useMemo(() => {
    if (!market) return;
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
      interestRateModel: { parameters },
      totalFloatingBorrowAssets,
    } = market;
    const assets = floatingAssetsAverage;
    if (assets === undefined) return;
    if (assets === 0n) {
      const installments = [];
      for (let count = 1; count <= MAX_INSTALLMENTS; count++) {
        installments.push({ count, payments: undefined, rate: 0n, total: 0n });
      }
      return { installments, firstMaturity };
    }
    const floatingUtilization = globalUtilization(assets, totalFloatingBorrowAssets, 0n);
    const marketUtilization = globalUtilization(assets, totalFloatingBorrowAssets, floatingBackupBorrowed);
    try {
      const installments = [];
      for (let count = 1; count <= MAX_INSTALLMENTS; count++) {
        if (count === 1) {
          const pool = fixedPools.find(
            ({ maturity }) => maturity >= firstMaturity && maturity < firstMaturity + MATURITY_INTERVAL,
          );
          if (!pool) {
            installments.push({ count, payments: undefined, rate: 0n, total: 0n });
            continue;
          }
          const { supplied, borrowed } = pool;
          const headroom = supplied > borrowed ? supplied - borrowed : 0n;
          const rate = fixedRate(
            firstMaturity,
            fixedPools.length,
            fixedUtilization(supplied, borrowed + amount, assets),
            floatingUtilization,
            globalUtilization(
              assets,
              totalFloatingBorrowAssets,
              floatingBackupBorrowed + (amount > headroom ? amount - headroom : 0n),
            ),
            parameters,
            now,
          );
          const fee = (amount * rate * BigInt(firstMaturity - now)) / (WAD * ONE_YEAR);
          const total = amount + fee;
          installments.push({ count, payments: [total], rate, total });
          continue;
        }
        const poolUtilizations = fixedPools
          .filter(({ maturity }) => maturity >= firstMaturity && maturity < firstMaturity + count * MATURITY_INTERVAL)
          .map(({ supplied, borrowed }) => fixedUtilization(supplied, borrowed, assets));
        if (poolUtilizations.length === 0) {
          installments.push({ count, payments: undefined, rate: 0n, total: 0n });
          continue;
        }
        const { installments: payments, effectiveRate } = splitInstallments(
          amount,
          assets,
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
  }, [market, floatingAssetsAverage, firstMaturity, now, amount]);
}
