import * as infra from "@account-kit/infra";
import {
  ChainType,
  config,
  createConfig as createLifiConfig,
  EVM,
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
import { queryOptions } from "@tanstack/react-query";
import { array, looseObject, number, object, optional, parse, pipe, record, regex, string } from "valibot";
import { encodeFunctionData, formatUnits, getAddress, type Address } from "viem";
import { anvil } from "viem/chains";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, { allowlist, exaAddress, mockSwapperAbi, swapperAddress } from "@exactly/common/generated/chain";
import { Address as AddressSchema, Hex } from "@exactly/common/validation";

import publicClient from "./publicClient";
import queryClient, { isServer } from "./queryClient";
import reportError from "./reportError";

export const lifiChainsOptions = queryOptions({
  queryKey: ["lifi", "chains"],
  staleTime: Infinity,
  gcTime: Infinity,
  enabled: !chain.testnet && chain.id !== anvil.id,
  queryFn: async () => {
    if (chain.testnet || chain.id === anvil.id) return [];
    try {
      ensureConfig();
      return await getChains({ chainTypes: [ChainType.EVM] });
    } catch (error) {
      reportError(error);
      return [];
    }
  },
});

export const lifiTokensOptions = queryOptions({
  queryKey: ["lifi", "tokens"],
  staleTime: Infinity,
  gcTime: Infinity,
  retry: 3,
  enabled: !chain.testnet && chain.id !== anvil.id,
  queryFn: async () => {
    if (chain.testnet || chain.id === anvil.id) return [];
    ensureConfig();
    const { tokens } = await getTokens({ chainTypes: [ChainType.EVM] });
    const allTokens = Object.values(tokens).flat();
    if (!allTokens.some((token) => token.chainId === (chain.id as typeof token.chainId))) {
      throw new Error("missing destination tokens");
    }
    if (!exaAddress) return allTokens;
    const exa = await getToken(chain.id, exaAddress).catch((error: unknown) => {
      reportError(error);
    });
    return exa
      ? [
          exa,
          ...allTokens.filter(
            (t) => t.chainId !== exa.chainId || t.address.toLowerCase() !== exa.address.toLowerCase(),
          ),
        ]
      : allTokens;
  },
});

export function balancesOptions(account: Address | undefined, nonce?: number) {
  return queryOptions({
    queryKey: nonce === undefined ? ["lifi", "balances", account] : ["lifi", "balances", account, nonce],
    staleTime: 30_000,
    gcTime: isServer ? Infinity : 60_000,
    enabled: !!account && !chain.testnet && chain.id !== anvil.id,
    queryFn: async () => {
      if (!account) return {} as Record<number, TokenAmount[]>;
      ensureConfig();
      const [balances, lifiTokens, exa] = await Promise.all([
        getWalletBalances(account, nonce).catch((error: unknown) => {
          reportError(error);
          return {} as Record<number, TokenAmount[]>;
        }),
        queryClient.fetchQuery(lifiTokensOptions).catch((error: unknown) => {
          reportError(error);
          return [] as Token[];
        }),
        exaAddress
          ? getToken(chain.id, exaAddress)
              .then((token) => getTokenBalancesByChain(account, { [chain.id]: [token] }))
              .then((result) => result[chain.id]?.[0])
              .catch((error: unknown) => {
                reportError(error);
              })
          : undefined,
      ]);
      const known = new Set(lifiTokens.map((token) => `${token.chainId}:${token.address.toLowerCase()}`));
      if (known.size > 0) {
        for (const [chainId, tokens] of Object.entries(balances)) {
          balances[Number(chainId)] = tokens.filter((token) => known.has(`${chainId}:${token.address.toLowerCase()}`));
        }
      }
      if (exa) {
        balances[chain.id] = [
          exa,
          ...(balances[chain.id] ?? []).filter((t) => t.address.toLowerCase() !== exa.address.toLowerCase()),
        ];
      }
      return balances;
    },
  });
}

export function bridgeSourcesOptions(account: Address | undefined, protocolSymbols: string[] = []) {
  return queryOptions({
    queryKey: ["bridge", "sources", account],
    queryFn: () => getBridgeSources(account),
    staleTime: 60_000,
    enabled: !!account && protocolSymbols.length > 0 && !chain.testnet && chain.id !== anvil.id,
  });
}

let configured = false;
function ensureConfig() {
  if (configured || chain.testnet || chain.id === anvil.id) return;
  createLifiConfig({
    integrator: "exa_app",
    apiKey: "4bdb54aa-4f28-4c61-992a-a2fdc87b0a0b.251e33ad-ef5e-40cb-9b0f-52d634b99e8f",
    preloadChains: false,
    providers: [EVM({ getWalletClient: () => Promise.resolve(publicClient) })],
    rpcUrls: Object.values(infra).reduce<Record<number, string[]>>((result, item) => {
      if (typeof item !== "object" || !("id" in item) || !("rpcUrls" in item)) return result;
      const { id, rpcUrls } = item as { id: number; rpcUrls: { alchemy?: { http?: readonly string[] } } };
      const url = rpcUrls.alchemy?.http?.[0];
      if (!url) return result;
      result[id] = [`${url}/${alchemyAPIKey}`];
      return result;
    }, {}),
  });
  config.loading = getChains({ chainTypes: [ChainType.EVM] })
    .then((availableChains) => {
      config.setChains(availableChains);
      queryClient.setQueryData(lifiChainsOptions.queryKey, availableChains);
    })
    .catch((error: unknown) => {
      configured = false;
      reportError(error);
    });
  configured = true;
  queryClient.prefetchQuery(lifiTokensOptions).catch(reportError);
}

export async function getRoute(
  fromToken: Hex,
  toToken: Hex,
  toAmount: bigint,
  account: Hex,
  receiver: Hex,
  denyExchanges?: Record<string, boolean>,
) {
  ensureConfig();
  if (chain.testnet || chain.id === anvil.id) {
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
    fromToken,
    toToken,
    toAmount: String(toAmount),
    fromAddress: account,
    toAddress: receiver,
    denyExchanges:
      denyExchanges &&
      Object.entries(denyExchanges)
        .filter(([_, value]) => value)
        .map(([key]) => key),
  });
  if (!transactionRequest?.to || !transactionRequest.data) throw new Error("missing quote transaction data");
  const chainId = transactionRequest.chainId ?? chain.id;
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
    fromAmount: BigInt(estimate.fromAmount),
  };
}

export async function getAllowTokens(markets: readonly { asset: string; symbol: string }[] = []) {
  ensureConfig();
  if (chain.testnet || chain.id === anvil.id) return [];
  const { tokens } = await getTokens({ chains: [chain.id] });
  const protocolAssets = markets.filter((m) => m.symbol.slice(3) !== "USDC.e").map((m) => m.asset);
  const allowed = new Set([...allowlist, ...protocolAssets].map((address) => address.toLowerCase()));
  const allowTokens = tokens[chain.id]?.filter((token) => allowed.has(token.address.toLowerCase())) ?? [];
  if (!exaAddress) return allowTokens;
  try {
    const exa = await getToken(chain.id, exaAddress);
    return [exa, ...allowTokens.filter((t) => t.address.toLowerCase() !== exa.address.toLowerCase())];
  } catch {
    return allowTokens;
  }
}

export type RouteFrom = {
  chainId: number;
  data: Hex;
  estimate: Estimate;
  gas?: bigint;
  gasPrice?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  to: Address;
  toAmount: bigint;
  tool?: string;
  value: bigint;
};

export const bridgeSlippage = 0.02;

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
  denyExchanges?: Record<string, boolean>;
  fromAddress: Address;
  fromAmount: bigint;
  fromChainId?: number;
  fromTokenAddress: string;
  toAddress: Address;
  toChainId?: number;
  toTokenAddress: string;
}): Promise<RouteFrom> {
  ensureConfig();
  if (chain.testnet || chain.id === anvil.id) {
    const from = getAddress(fromTokenAddress);
    const to = getAddress(toTokenAddress);
    const toAmount = await publicClient.readContract({
      abi: mockSwapperAbi,
      functionName: "getAmountOut",
      address: swapperAddress,
      args: [from, fromAmount, to],
    });
    return {
      chainId: chain.id,
      to: swapperAddress,
      value: 0n,
      toAmount,
      tool: "mockSwapper",
      data: encodeFunctionData({
        abi: mockSwapperAbi,
        functionName: "swapExactAmountIn",
        args: [from, fromAmount, to, toAmount, toAddress],
      }),
      estimate: {
        tool: "mockSwapper",
        fromAmount: String(fromAmount),
        toAmount: String(toAmount),
        toAmountMin: String(toAmount),
        approvalAddress: swapperAddress,
        executionDuration: 0,
      },
    };
  }
  config.set({ integrator: "exa_app", userId: fromAddress });
  const { estimate, transactionRequest, tool } = await getQuote({
    fee: 0.0025,
    slippage: bridgeSlippage,
    integrator: "exa_app",
    fromChain: fromChainId ?? chain.id,
    toChain: toChainId ?? chain.id,
    fromToken: fromTokenAddress,
    toToken: toTokenAddress,
    fromAmount: String(fromAmount),
    fromAddress,
    toAddress,
    denyExchanges:
      denyExchanges &&
      Object.entries(denyExchanges)
        .filter(([_, value]) => value)
        .map(([key]) => key),
  });
  if (!transactionRequest?.to || !transactionRequest.data) throw new Error("missing quote transaction data");
  const chainId = transactionRequest.chainId ?? fromChainId ?? chain.id;
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

export type TokenBalance = { balance: bigint; token: Token; usdValue: number };

export function tokenAmountsToBalances(tokenAmounts: TokenAmount[]): TokenBalance[] {
  return tokenAmounts
    .filter((token): token is TokenAmount & { amount: bigint } => !!token.amount && token.amount > 0n)
    .map((token) => {
      const balance = token.amount;
      const rawUsd = Number(formatUnits(balance, token.decimals)) * Number(token.priceUSD);
      const usdValue = Number.isFinite(rawUsd) && rawUsd > 0 ? rawUsd : 0;
      return { token, balance, usdValue };
    })
    .sort((a, b) => {
      if (b.usdValue !== a.usdValue) return b.usdValue - a.usdValue;
      return a.token.symbol.localeCompare(b.token.symbol);
    });
}

export type BridgeSources = {
  balancesByChain: Record<number, TokenBalance[]>;
  chains: ExtendedChain[];
  defaultChainId?: number;
  defaultTokenAddress?: string;
  tokensByChain: Record<number, Token[]>;
  usdByChain: Record<number, number>;
  usdByToken: Record<string, number>;
};

export async function getBridgeSources(account?: Address): Promise<BridgeSources> {
  ensureConfig();
  if (!account) throw new Error("account is required");
  const cachedTokens = queryClient.getQueryData<Token[]>(lifiTokensOptions.queryKey);
  const [supportedChains, allTokens, allBalances] = await Promise.all([
    queryClient.getQueryData<ExtendedChain[]>(lifiChainsOptions.queryKey) ?? queryClient.fetchQuery(lifiChainsOptions),
    cachedTokens?.some((token) => token.chainId === (chain.id as typeof token.chainId))
      ? cachedTokens
      : queryClient.fetchQuery(lifiTokensOptions).catch((error: unknown) => {
          reportError(error);
          return [] as Token[];
        }),
    queryClient.fetchQuery(balancesOptions(account)),
  ]);

  const usdByChain: Record<number, number> = {};
  const usdByToken: Record<string, number> = {};
  const destinationTokens = allTokens.filter((token) => token.chainId === (chain.id as typeof token.chainId));
  const balancesByChain: Record<number, TokenBalance[]> = {};

  for (const [chainId, tokenAmounts] of Object.entries(allBalances)) {
    const id = Number(chainId);
    const balances = tokenAmountsToBalances(tokenAmounts);

    if (id === chain.id) {
      for (const { token, usdValue } of balances) {
        const key = `${id}:${token.address.toLowerCase()}`;
        usdByToken[key] = usdValue;
      }
    }

    if (balances.length > 0) {
      balancesByChain[id] = balances;
    }

    const total = balances.reduce((sum, { usdValue }) => sum + usdValue, 0);
    if (total > 0) usdByChain[id] = total;
  }

  const chains = [...supportedChains]
    .filter((c) => (balancesByChain[c.id]?.length ?? 0) > 0)
    .sort((a, b) => {
      const bValue = usdByChain[b.id] ?? 0;
      const aValue = usdByChain[a.id] ?? 0;
      if (bValue !== aValue) return bValue - aValue;
      return a.name.localeCompare(b.name);
    });

  const defaultChainId = chains[0]?.id;

  let defaultTokenAddress: string | undefined;
  if (defaultChainId !== undefined) {
    defaultTokenAddress = balancesByChain[defaultChainId]?.[0]?.token.address;
  }

  return {
    chains,
    tokensByChain: { [chain.id]: destinationTokens },
    usdByChain,
    usdByToken,
    balancesByChain,
    defaultChainId,
    defaultTokenAddress,
  };
}

async function getWalletBalances(account: Address, nonce?: number) {
  const balances: Record<number, TokenAmount[]> = {};
  const lifiConfig = config.get();
  let offset: string | undefined;
  do {
    const url = new URL(`${lifiConfig.apiUrl}/wallets/${account}/balances`);
    url.searchParams.set("extended", "true");
    url.searchParams.set("limit", "1000");
    if (nonce !== undefined) url.searchParams.set("_", String(nonce));
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, {
      headers: {
        ...(lifiConfig.apiKey && { "x-lifi-api-key": lifiConfig.apiKey }),
        ...(lifiConfig.integrator && { "x-lifi-integrator": lifiConfig.integrator }),
      },
    });
    if (!response.ok) throw new Error("wallet balances request failed");
    const json = parse(
      object({
        balances: optional(
          record(
            string(),
            array(
              looseObject({
                chainId: number(),
                address: string(),
                symbol: string(),
                decimals: number(),
                name: string(),
                priceUSD: optional(string(), "0"),
                logoURI: optional(string()),
                amount: pipe(string(), regex(/^\d+$/)),
              }),
            ),
          ),
        ),
        offset: optional(string()),
      }),
      await response.json(),
    );
    for (const [chainId, tokens] of Object.entries(json.balances ?? {})) {
      const id = Number(chainId);
      if (!Number.isInteger(id)) continue;
      balances[id] = [
        ...(balances[id] ?? []),
        ...tokens.map(({ amount, ...token }) => ({ ...token, amount: BigInt(amount) })),
      ];
    }
    offset = json.offset;
  } while (offset);
  return balances;
}

export const tokenCorrelation = {
  ETH: "ETH",
  WETH: "ETH",
  "WETH.e": "ETH",

  USDT0: "USDT",

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
