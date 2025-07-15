import { getToken, getTokens, type Token } from "@lifi/sdk";
import type { Address } from "viem";
import { optimism } from "viem/chains";

export default async function lifiTokens(chainId: number, addresses: Address[]) {
  if (chainId !== optimism.id) {
    const exa: Token = {
      address: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
      chainId,
      decimals: 18,
      name: "Exactly token",
      symbol: "EXA",
      priceUSD: "2",
    };
    const usdc: Token = {
      address: "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e",
      chainId,
      decimals: 6,
      name: "USD Coin",
      symbol: "USDC",
      priceUSD: "1",
    };
    return [exa, usdc];
  }
  const response = await getTokens({ chains: [chainId] });
  const tokens = response.tokens[chainId];

  if (!tokens) throw new Error("no tokens found for chain");

  const missingTokens = await Promise.all(
    addresses.filter((a) => !tokens.some((t) => t.address === a)).map((a) => getToken(chainId, a)),
  );

  return [...tokens, ...missingTokens];
}
