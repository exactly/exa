const assetLogos = {
  USDC: "https://app.exact.ly/img/assets/USDC.svg",
  ETH: "https://app.exact.ly/img/assets/WETH.svg",
  wstETH: "https://app.exact.ly/img/assets/wstETH.svg",
  OP: "https://app.exact.ly/img/assets/OP.svg",
  WBTC: "https://app.exact.ly/img/assets/WBTC.svg",
  DAI: "https://app.exact.ly/img/assets/DAI.svg",
  "USDC.e": "https://app.exact.ly/img/assets/USDC.e.svg",
} as const;

export function getTokenLogoURI(tokens: { logoURI?: string; symbol: string }[], symbol: string): string | undefined {
  const search = symbol === "ETH" ? "WETH" : symbol;
  const key = symbol === "WETH" ? "ETH" : symbol;
  return (
    (Object.hasOwn(assetLogos, key) ? assetLogos[key as keyof typeof assetLogos] : undefined) ??
    tokens.find((token) => token.symbol === search || token.symbol === symbol)?.logoURI
  );
}

export default assetLogos;
