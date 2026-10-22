import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";

import chain, { alchemyChains, allowlists } from "@exactly/common/generated/chain";

import { allowlistOptions, type Allowlists } from "./lifi";
import pluginOptions from "./pluginOptions";
import useAccount from "./useAccount";

import type { Credential } from "@exactly/common/validation";

export default function useAllowlists() {
  const { address } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const plugins = useQueries({
    queries: chain.testnet ? [] : chains.map((id) => pluginOptions(address, credential?.factory, id)),
  });
  return useQueries({ queries: chains.map((id, index) => allowlistOptions(plugins[index]?.data, id)), combine });
}

export const chains = Object.keys(allowlists)
  .map(Number)
  .filter((id) => Number.isInteger(id) && (id === chain.id || alchemyChains.has(id)));

const snapshot = Object.entries(allowlists).map(
  ([id, targets]) => [Number(id), targets && new Set(targets.map((target) => target.toLowerCase()))] as const,
);
const sets = new WeakMap<readonly string[], ReadonlySet<string>>();

function combine(results: UseQueryResult<{ targets: readonly string[] }>[]): Allowlists {
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
