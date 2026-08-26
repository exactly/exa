import { queryOptions, skipToken } from "@tanstack/react-query";
import { createPublicClient, fallback, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize, toCoinType } from "viem/ens";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";

import alchemyChains from "./alchemyChains";

export default function ensOptions(name: string | undefined, chainId: number) {
  return queryOptions({
    queryKey: ["ens", name, chainId],
    queryFn: name
      ? async () =>
          (await client.getEnsAddress({ name, coinType: toCoinType(chainId) })) ??
          (await client.getEnsAddress({ name }))
      : skipToken,
    meta: { warnError: () => true },
    retry: false,
    staleTime: 60_000,
  });
}

export function ensName(input: string) {
  const value = input.trim();
  if (!value.includes(".")) return;
  try {
    return normalize(value);
  } catch {} // eslint-disable-line no-empty -- rejects malformed names
}

const alchemyURL = alchemyChains.get(mainnet.id)?.rpcUrls.alchemy?.http[0];
const client = createPublicClient({
  chain: mainnet,
  transport: alchemyURL && alchemyAPIKey ? fallback([http(`${alchemyURL}/${alchemyAPIKey}`), http()]) : http(),
});
