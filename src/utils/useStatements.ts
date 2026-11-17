import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import useDebts from "./useDebts";

import type { CardActivity } from "./server";

export default function useStatements() {
  const { data: activity, isPending } = useQuery<CardActivity[]>({ queryKey: ["activity", "card"] });
  const { debts, complete } = useDebts();
  return useMemo(() => {
    if (!activity) return isPending ? undefined : [];
    if (!debts || !complete) return;
    const due = new Set(debts.map(({ maturity }) => Number(maturity)));
    const maturities = new Set<number>();
    for (const item of activity) {
      const borrows =
        item.type === "panda"
          ? item.operations.flatMap((operation) => ("borrow" in operation ? [operation.borrow] : []))
          : "borrow" in item
            ? [item.borrow]
            : [];
      for (const borrow of borrows) {
        if ("installments" in borrow)
          for (const installment of borrow.installments) maturities.add(installment.maturity);
        else maturities.add(borrow.maturity);
      }
    }
    return [...maturities].filter((m) => !due.has(m)).sort((a, b) => b - a);
  }, [activity, complete, debts, isPending]);
}
