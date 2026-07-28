import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { marketUSDCAddress } from "@exactly/common/generated/chain";

import useMarkets from "./useMarkets";

import type { ActivityItem } from "./queryClient";

export default function useStatements() {
  const { data: activity, isPending } = useQuery<ActivityItem[]>({ queryKey: ["activity"] });
  const { markets } = useMarkets();
  return useMemo(() => {
    if (!activity) return isPending ? undefined : [];
    if (!markets) return;
    const debts = new Set(
      markets
        .filter(({ market }) => market === marketUSDCAddress)
        .flatMap(({ fixedBorrowPositions }) =>
          fixedBorrowPositions.filter(({ previewValue }) => previewValue > 0n).map(({ maturity }) => Number(maturity)),
        ),
    );
    const maturities = new Set<number>();
    for (const item of activity) {
      const borrows =
        item.type === "panda"
          ? item.operations.flatMap((operation) => ("borrow" in operation ? [operation.borrow] : []))
          : item.type === "card" && "borrow" in item
            ? [item.borrow]
            : [];
      for (const borrow of borrows) {
        if ("installments" in borrow)
          for (const installment of borrow.installments) maturities.add(installment.maturity);
        else maturities.add(borrow.maturity);
      }
    }
    return [...maturities].filter((m) => !debts.has(m)).sort((a, b) => b - a);
  }, [activity, isPending, markets]);
}
