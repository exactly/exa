import { useCallback } from "react";

import { skipToken, useQuery } from "@tanstack/react-query";

import { marketUSDCAddress } from "@exactly/common/generated/chain";

import { getStatementActivity } from "./server";
import useMarkets from "./useMarkets";

export default function useStatement(maturity: number | undefined) {
  const { markets } = useMarkets();
  const symbol = markets?.find(({ market }) => market === marketUSDCAddress)?.assetSymbol;
  return useQuery({
    queryKey: ["activity", "statement", maturity],
    queryFn: maturity === undefined ? skipToken : () => getStatementActivity(maturity),
    select: useCallback(
      (activity: Awaited<ReturnType<typeof getStatementActivity>>) =>
        activity.filter((item) => item.type !== "repay" || item.currency === symbol),
      [symbol],
    ),
  });
}
