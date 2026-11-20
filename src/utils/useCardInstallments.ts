import { useQuery } from "@tanstack/react-query";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import maxCardInstallments from "@exactly/common/maxCardInstallments";

import useMarkets from "./useMarkets";

export default function useCardInstallments() {
  const { markets } = useMarkets();
  const { data: remembered } = useQuery<number>({ queryKey: ["settings", "installments"] });
  const market = markets?.find(({ market: address }) => address === marketUSDCAddress);
  const max = market ? maxCardInstallments(market.maxFuturePools) : MAX_INSTALLMENTS;
  return { max, last: Math.min(remembered ?? 1, max) };
}
