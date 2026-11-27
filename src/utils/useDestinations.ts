import { useCallback } from "react";

import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { safeParse } from "valibot";

import { Address } from "@exactly/common/validation";

import create3Options from "./create3Options";
import exaOptions from "./exaOptions";
import useAccount from "./useAccount";

export default function useDestinations(receiver: unknown, chainIds: number[]) {
  const { address } = useAccount();
  const account = safeParse(Address, receiver);
  const own = account.success && account.output.toLowerCase() === address?.toLowerCase();
  const { data: isExa, isFetching } = useQuery({
    ...exaOptions(account.success ? account.output : undefined),
    enabled: !own && chainIds.length > 0,
  });
  const { unsupported, isPending } = useQueries({
    queries: own || isExa ? chainIds.map((chainId) => create3Options(chainId)) : [],
    combine: useCallback(
      (results: UseQueryResult<boolean>[]) => ({
        unsupported: chainIds.slice(0, results.length).filter((_, index) => !results[index]?.data),
        isPending: results.some((result) => result.isPending),
      }),
      [chainIds],
    ),
  });
  return { unsupported, isLoading: isFetching || isPending };
}
