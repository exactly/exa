const assetLogos = {
  USDC: "https://app.exact.ly/img/assets/USDC.svg",
  ETH: "https://app.exact.ly/img/assets/WETH.svg",
  wstETH: "https://app.exact.ly/img/assets/wstETH.svg",
  OP: "https://app.exact.ly/img/assets/OP.svg",
  WBTC: "https://app.exact.ly/img/assets/WBTC.svg",
  DAI: "https://app.exact.ly/img/assets/DAI.svg",
  "USDC.e": "https://app.exact.ly/img/assets/USDC.e.svg",
} as const;

export function getTokenLogoURI(tokens: TokenLogo[], symbol: string, chainId: number): string | undefined {
  const key = symbol === "WETH" ? "ETH" : symbol;
  if (Object.hasOwn(assetLogos, key)) return assetLogos[key as keyof typeof assetLogos];
  let logos = logoURIs.get(tokens);
  if (!logos) {
    logos = new Map<string, string>();
    for (const token of tokens) {
      if (!token.logoURI) continue;
      const entry = `${token.chainId}:${token.symbol}`;
      if (!logos.has(entry)) logos.set(entry, token.logoURI);
    }
    logoURIs.set(tokens, logos);
  }
  return logos.get(`${chainId}:${symbol}`);
}

const logoURIs = new WeakMap<TokenLogo[], Map<string, string>>();

type TokenLogo = { chainId: number; logoURI?: string; symbol: string };

export default assetLogos;
