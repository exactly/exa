import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";

import { allowlists } from "@exactly/common/generated/chain";

import { allowlistOptions } from "./lifi";
import useAccount from "./useAccount";

import type { Credential } from "@exactly/common/validation";

export default function useAllowlists() {
  const { address } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  return useQueries({
    queries: chains.map((id) => allowlistOptions(address, credential?.factory, Number(id))),
    combine,
  });
}

const chains = Object.keys(allowlists);

function combine(results: UseQueryResult<{ targets: readonly string[] }>[]): typeof allowlists {
  return Object.fromEntries(chains.map((id, index) => [id, results[index]?.data?.targets] as const));
}
