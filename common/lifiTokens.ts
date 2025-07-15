import { getToken, getTokens } from "@lifi/sdk";
import type { Address } from "viem";

export default async function lifiTokens(chainId: number, addresses: Address[]) {
  const response = await getTokens({ chains: [chainId] });
  const tokens = response.tokens[chainId];

  if (!tokens) throw new Error("no tokens found for chain");

  const missingTokens = await Promise.all(
    addresses.filter((a) => !tokens.some((t) => t.address === a)).map((a) => getToken(chainId, a)),
  );

  return [...tokens, ...missingTokens];
}
