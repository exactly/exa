import { useQueries, type UseQueryResult } from "@tanstack/react-query";

import chain, { alchemyChains, allowlists } from "@exactly/common/generated/chain";

import allowlistOptions from "./allowlistOptions";
import useAccount from "./useAccount";

import type { Allowlists } from "./lifi";

export default function useAllowlists() {
  const { address } = useAccount();
  return useQueries({ queries: chains.map((id) => allowlistOptions(address, id)), combine });
}

export const chains = Object.keys(allowlists)
  .map(Number)
  .filter((id) => Number.isInteger(id) && (id === chain.id || alchemyChains.get(id)?.smartAccount));

const snapshot = Object.entries(allowlists).map(
  ([id, targets]) => [Number(id), targets && new Set(targets.map((target) => target.toLowerCase()))] as const,
);
const sets = new WeakMap<readonly string[], ReadonlySet<string>>();

function combine(results: UseQueryResult<null | { targets: readonly string[] }>[]): Allowlists {
  return Object.fromEntries(
    snapshot.map(([id, fallback]) => {
      const targets = results[chains.indexOf(id)]?.data?.targets;
      if (!targets) return [id, fallback];
      let set = sets.get(targets);
      if (!set) {
        set = new Set(targets);
        sets.set(targets, set);
      }
      return [id, set];
    }),
  );
}
