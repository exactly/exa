import chain, { mockSwapperAbi, swapperAddress } from "@exactly/common/generated/chain";
import { Address as AddressSchema, Hex } from "@exactly/common/validation";
import {
  ChainType,
  config,
  getChains,
  getQuote,
  getToken,
  getTokenBalancesByChain,
  getTokens,
  type Estimate,
  type ExtendedChain,
  type Token,
  type TokenAmount,
} from "@lifi/sdk";
import { parse } from "valibot";
import { encodeFunctionData, formatUnits } from "viem";
import type { Address } from "viem";
import { optimismSepolia } from "viem/chains";

import publicClient from "./publicClient";

export async function getRoute(
  fromToken: Hex,
  toToken: Hex,
  toAmount: bigint,
  account: Hex,
  receiver: Hex,
  denyExchanges?: Record<string, boolean>,
) {
  if (chain.id === optimismSepolia.id) {
    const fromAmount = await publicClient.readContract({
      abi: mockSwapperAbi,
      functionName: "getAmountIn",
      address: parse(Hex, swapperAddress),
      args: [fromToken, toAmount, toToken],
    });
    return {
      tool: "mockSwapper",
      fromAmount,
      data: parse(
        Hex,
        encodeFunctionData<typeof mockSwapperAbi>({
          abi: mockSwapperAbi,
          functionName: "swapExactAmountOut",
          args: [fromToken, fromAmount, toToken, toAmount, receiver],
        }),
      ),
    };
  }
  config.set({ integrator: "exa_app", userId: account });
  const { estimate, transactionRequest, tool } = await getQuote({
    fee: 0.0025,
    slippage: 0.015,
    integrator: "exa_app",
    fromChain: chain.id,
    toChain: chain.id,
    fromToken: fromToken.toString(),
    toToken: toToken.toString(),
    toAmount: toAmount.toString(),
    fromAddress: account,
    toAddress: receiver,
    denyExchanges:
      denyExchanges &&
      Object.entries(denyExchanges)
        .filter(([_, value]) => value)
        .map(([key]) => key),
  });
  if (!transactionRequest?.to || !transactionRequest.data) throw new Error("missing quote transaction data");
  const chainId = Number(transactionRequest.chainId ?? chain.id);
  const gasLimit = transactionRequest.gasLimit;
  return {
    chainId,
    to: parse(AddressSchema, transactionRequest.to),
    data: parse(Hex, transactionRequest.data),
    value: transactionRequest.value ? BigInt(transactionRequest.value) : 0n,
    gas: gasLimit ? BigInt(gasLimit) : undefined,
    gasPrice: transactionRequest.gasPrice ? BigInt(transactionRequest.gasPrice) : undefined,
    maxFeePerGas: transactionRequest.maxFeePerGas ? BigInt(transactionRequest.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas
      ? BigInt(transactionRequest.maxPriorityFeePerGas)
      : undefined,
    tool,
    estimate,
    toAmount: BigInt(estimate.toAmount),
  };
}

async function getAllTokens(): Promise<Token[]> {
  const response = await getTokens({ chains: [chain.id] });
  const exa = await getToken(chain.id, "0x1e925De1c68ef83bD98eE3E130eF14a50309C01B");
  return [exa, ...(response.tokens[chain.id] ?? [])];
}

export async function getAsset(account: Address) {
  const tokens = await getAllTokens();
  return tokens.find((token) => token.address === account);
}

export async function getTokenBalances(account: Address) {
  const tokens = await getAllTokens();
  const balances = await getTokenBalancesByChain(account, { [chain.id]: tokens });
  return balances[chain.id]?.filter((balance) => balance.amount && balance.amount > 0n) ?? [];
}

const allowList = new Set([
  "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  "0x4200000000000000000000000000000000000042",
  "0x4200000000000000000000000000000000000006",
  "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
  "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb",
  "0x078f358208685046a11C85e8ad32895DED33A249",
  "0x0994206dfE8De6Ec6920FF4D779B0d950605Fb53",
  "0x14778860E937f509e651192a90589dE711Fb88a9",
  "0x191c10Aa4AF7C30e871E70C95dB0E4eb77237530",
  "0x1e925De1c68ef83bD98eE3E130eF14a50309C01B",
  "0x23ee2343B892b1BB63503a4FAbc840E0e2C6810f",
  "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6",
  "0x513c7E3a9c69cA3e22550eF58AC1C0088e918FFf",
  "0x625E7708f30cA75bfd92586e17077590C60eb4cD",
  "0x6985884C4392D348587B19cb9eAAf157F13271cd",
  "0x6ab707Aca953eDAeFBc4fD23bA73294241490620",
  "0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97",
  "0x6fd9d7AD17242c41f7131d257212c54A0e816691",
  "0x724dc807b04555b71ed48a6896b6F41593b8C637",
  "0x76FB31fb4af56892A25e32cFC43De717950c9278",
  "0x7FB688CCf682d58f86D7e38e03f9D22e7705448B",
  "0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE",
  "0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4",
  "0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9",
  "0x8Eb270e296023E9D92081fdF967dDd7878724424",
  "0x920Cf626a271321C151D027030D5d08aF699456b",
  "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
  "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
  "0x9Bcef72be871e61ED4fBbc7630889beE758eb81D",
  "0xadDb6A0412DE1BA0F936DCaeb8Aaa24578dcF3B2",
  "0xc40F949F8a4e094D1b49a23ea9241D289B7b2819",
  "0xc45A479877e1e9Dfe9FcD4056c699575a1045dAA",
  "0xc5102fE9359FD9a28f877a67E36B0F050d81a3CC",
  "0xC52D7F23a2e460248Db6eE192Cb23dD12bDDCbf6",
  "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  "0xdC6fF44d5d932Cbd77B52E5612Ba0529DC6226F1",
  "0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8",
  "0xf329e36C7bF6E5E86ce2150875a84Ce77f477375",
  "0xFdb794692724153d1488CcdBE0C56c252596735F",
]);

export async function getAllowTokens() {
  const exa = await getToken(chain.id, "0x1e925De1c68ef83bD98eE3E130eF14a50309C01B");
  const { tokens } = await getTokens({ chains: [chain.id] });
  const allowTokens = tokens[chain.id]?.filter((token) => allowList.has(token.address)) ?? [];
  return [exa, ...allowTokens];
}

export interface RouteFrom {
  chainId: number;
  to: Address;
  data: Hex;
  value: bigint;
  gas?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  tool?: string;
  estimate: Estimate;
  toAmount: bigint;
}

export async function getRouteFrom({
  fromChainId,
  toChainId,
  fromTokenAddress,
  toTokenAddress,
  fromAmount,
  fromAddress,
  toAddress,
  denyExchanges,
}: {
  fromChainId?: number;
  toChainId?: number;
  fromTokenAddress: string;
  toTokenAddress: string;
  fromAmount: bigint;
  fromAddress: Address;
  toAddress: Address;
  denyExchanges?: Record<string, boolean>;
}): Promise<RouteFrom> {
  config.set({ integrator: "exa_app", userId: fromAddress });
  const { estimate, transactionRequest, tool } = await getQuote({
    fee: 0.0025,
    slippage: 0.02,
    integrator: "exa_app",
    fromChain: fromChainId ?? chain.id,
    toChain: toChainId ?? chain.id,
    fromToken: fromTokenAddress,
    toToken: toTokenAddress,
    fromAmount: fromAmount.toString(),
    fromAddress,
    toAddress,
    denyExchanges:
      denyExchanges &&
      Object.entries(denyExchanges)
        .filter(([_, value]) => value)
        .map(([key]) => key),
  });
  if (!transactionRequest?.to || !transactionRequest.data) throw new Error("missing quote transaction data");
  const chainId = Number(transactionRequest.chainId ?? fromChainId);
  const gasLimit = transactionRequest.gasLimit;
  return {
    chainId,
    to: parse(AddressSchema, transactionRequest.to),
    data: parse(Hex, transactionRequest.data),
    value: transactionRequest.value ? BigInt(transactionRequest.value) : 0n,
    gas: gasLimit ? BigInt(gasLimit) : undefined,
    gasPrice: transactionRequest.gasPrice ? BigInt(transactionRequest.gasPrice) : undefined,
    maxFeePerGas: transactionRequest.maxFeePerGas ? BigInt(transactionRequest.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: transactionRequest.maxPriorityFeePerGas
      ? BigInt(transactionRequest.maxPriorityFeePerGas)
      : undefined,
    tool,
    estimate,
    toAmount: BigInt(estimate.toAmount),
  };
}

export interface BridgeSources {
  chains: ExtendedChain[];
  tokensByChain: Record<number, Token[]>;
  balancesByChain: Record<number, TokenAmount[]>;
  usdByChain: Record<number, number>;
  usdByToken: Record<string, number>;
  ownerAssetsByChain: Record<number, { token: Token; balance: bigint; usdValue: number }[]>;
  defaultChainId?: number;
  defaultTokenAddress?: string;
}

export async function getBridgeSources(account?: string, protocolSymbols: string[] = []): Promise<BridgeSources> {
  if (!account) throw new Error("account is required");
  const bridgeTokenSymbols = new Set(protocolSymbols);
  if (bridgeTokenSymbols.size === 0) throw new Error("protocol symbols is required");
  const supportedChains = await getChains({ chainTypes: [ChainType.EVM] });
  const chainIds = supportedChains.map((item) => item.id);
  const { tokens: supportedTokens } = await getTokens({ chainTypes: [ChainType.EVM] });

  const usdByChain: Record<number, number> = {};
  const usdByToken: Record<string, number> = {};
  const tokensByChain: Record<number, Token[]> = {};
  const ownerAssetsByChain: Record<number, { token: Token; balance: bigint; usdValue: number }[]> = {};

  for (const id of chainIds) {
    const chainTokens = supportedTokens[id] ?? [];
    if (chainTokens.length > 0) tokensByChain[id] = chainTokens;
  }

  const balancesByChain = await getTokenBalancesByChain(
    account,
    Object.fromEntries(Object.entries(tokensByChain).map(([id, chainTokens]) => [Number(id), chainTokens])),
  );

  for (const [chainId, chainTokens] of Object.entries(tokensByChain)) {
    const id = Number(chainId);
    const tokenAmounts = balancesByChain[id] ?? [];
    const assets = chainTokens.map((token) => {
      const balance = tokenAmounts.find((t) => t.address === token.address)?.amount ?? 0n;
      const key = `${id}:${token.address}`;
      const usdValue = Number(formatUnits(balance, token.decimals)) * Number(token.priceUSD);
      usdByToken[key] = usdValue;
      return { token, balance, usdValue };
    });

    const relevantAssets = assets
      .filter(({ usdValue }) => usdValue > 0)
      .toSorted((a, b) => {
        if (b.usdValue !== a.usdValue) return b.usdValue - a.usdValue;
        return a.token.symbol.localeCompare(b.token.symbol);
      });

    if (relevantAssets.length > 0) {
      ownerAssetsByChain[id] = relevantAssets;
    }

    const total = relevantAssets.reduce((sum, { usdValue }) => sum + usdValue, 0);
    if (total > 0) usdByChain[id] = total;
  }

  const chains = [...supportedChains]
    .filter((c) => (usdByChain[c.id] ?? 0) > 0)
    .toSorted((a, b) => {
      const bValue = usdByChain[b.id] ?? 0;
      const aValue = usdByChain[a.id] ?? 0;
      if (bValue !== aValue) return bValue - aValue;
      return a.name.localeCompare(b.name);
    });

  const defaultChainId = chains[0]?.id;

  let defaultTokenAddress: string | undefined;
  if (defaultChainId !== undefined) {
    const assetsForChain = ownerAssetsByChain[defaultChainId] ?? [];
    defaultTokenAddress = assetsForChain[0]?.token.address;
  }

  return {
    chains,
    tokensByChain,
    balancesByChain,
    usdByChain,
    usdByToken,
    ownerAssetsByChain,
    defaultChainId,
    defaultTokenAddress,
  };
}

export const tokenCorrelation = {
  ETH: "ETH",
  WETH: "ETH",
  "WETH.e": "ETH",

  // #region liquid staked ETH
  cbETH: "wstETH",
  ETHx: "wstETH",
  ezETH: "wstETH",
  osETH: "wstETH",
  rETH: "wstETH",
  sfrxETH: "wstETH", // cspell:ignore sfrxETH
  stETH: "wstETH",
  superOETHb: "wstETH",
  tETH: "wstETH",
  wBETH: "wstETH",
  weETH: "wstETH",
  wrsETH: "wstETH",
  wstETH: "wstETH",
  // #endregion

  // #region wrapped BTC
  BTCB: "WBTC",
  cbBTC: "WBTC",
  eBTC: "WBTC",
  FBTC: "WBTC", // cspell:ignore FBTC
  LBTC: "WBTC", // cspell:ignore LBTC
  tBTC: "WBTC",
  WBTC: "WBTC",
  "BTC.b": "WBTC",
  // #endregion
} as const;
