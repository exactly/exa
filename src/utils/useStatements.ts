import { useMemo } from "react";

import { useQuery } from "@tanstack/react-query";

import { MATURITY_INTERVAL } from "@exactly/lib";

import useMarkets from "./useMarkets";

import type { ActivityItem } from "./queryClient";

export default function useStatements() {
  const { data: activity } = useQuery<ActivityItem[]>({ queryKey: ["activity"] });
  const { timestamp } = useMarkets();
  return useMemo(() => {
    if (!activity) return [];
    const now = Number(timestamp);
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
    return [...maturities].filter((m) => m - MATURITY_INTERVAL < now).sort((a, b) => b - a);
  }, [activity, timestamp]);
}
