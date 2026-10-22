import { useCallback, useEffect } from "react";

import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";

import chain, { alchemyChains, allowlists } from "@exactly/common/generated/chain";

import { lifiTokensOptions } from "./lifi";
import networkOptions from "./networkOptions";
import queryClient from "./queryClient";
import reportError from "./reportError";
import useAccount from "./useAccount";

import type { Allowlists } from "./lifi";

export default function useAllowlists() {
  const { address } = useAccount();
  const { isSuccess: lifi } = useQuery({ ...lifiTokensOptions, enabled: false });
  const { allowlists: onchain, partial } = useQueries({
    queries: chains.map((chainId) => networkOptions(address, chainId)),
    combine: useCallback(
      (
        results: UseQueryResult<{ allowlist: null | readonly string[]; lifi: boolean }>[],
      ): { allowlists: Allowlists; partial: string } => ({
        allowlists: Object.fromEntries(
          snapshot.map(([id, fallback]) => {
            const targets = results[chains.indexOf(id)]?.data?.allowlist;
            return [id, targets ? new Set(targets) : fallback];
          }),
        ),
        partial: results
          .filter(({ data }) => data?.lifi === false)
          .map(({ dataUpdatedAt }) => dataUpdatedAt)
          .join(","),
      }),
      [],
    ),
  });
  useEffect(() => {
    if (!lifi || !partial) return;
    queryClient
      .invalidateQueries({
        queryKey: ["network"],
        predicate: ({ state: { data, fetchStatus } }) =>
          fetchStatus === "idle" && (data as undefined | { lifi: boolean })?.lifi === false,
      })
      .catch(reportError);
  }, [lifi, partial]);
  return onchain;
}

export const chains = Object.keys(allowlists)
  .map(Number)
  .filter((id) => Number.isInteger(id) && (id === chain.id || alchemyChains.get(id)?.smartAccount));

const snapshot = Object.entries(allowlists).map(
  ([id, targets]) => [Number(id), targets && new Set(targets.map((target) => target.toLowerCase()))] as const,
);
