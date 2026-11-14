import { vValidator } from "@hono/valibot-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  array,
  custom,
  maxValue,
  minLength,
  minValue,
  number,
  object,
  optional,
  pipe,
  regex,
  string,
  toBigint,
  toNumber,
  transform,
  union,
} from "valibot";
import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAbiItem,
  getAddress,
  parseAbi,
  parseEventLogs,
  toHex,
  zeroAddress,
} from "viem";

import chain, { allowlists, exaPreviewerAbi, mockSwapperAbi, networks } from "@exactly/common/generated/chain";
import { Address, Hash, Hex } from "@exactly/common/validation";

import { bridgeCompletions } from "../database/indexer";
import { NETWORKS } from "../utils/alchemy";
import { alchemyClient } from "../utils/publicClient";
import validatorHook from "../utils/validatorHook";

import type * as schema from "../database/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const velodromeAbi = parseAbi(["function getPool(address tokenA, address tokenB, bool stable) view returns (address)"]);

export default function hook({ database }: { database: NodePgDatabase<typeof schema> }) {
  if (!chain.testnet) throw new Error("mockfi outside testnets");
  const sources = new Map(
    [...NETWORKS.values()].flatMap((network) => {
      const contracts = networks.get(network.id);
      return contracts ? [[network.id, { ...contracts, chain: network, client: alchemyClient(network) }] as const] : [];
    }),
  );
  type Source = typeof sources extends ReadonlyMap<number, infer S> ? S : never;
  const Network = pipe(
    union([string(), number()]),
    transform((id) => sources.get(Number(id))),
    custom<Source>((source) => source !== undefined, "unsupported chain"),
  );
  const Quote = {
    fromAddress: Address,
    fromChain: Network,
    fromToken: Address,
    integrator: optional(string(), ""),
    slippage: optional(Slippage, "0.005"),
    toAddress: optional(Address),
    toChain: Network,
    toToken: Address,
  };
  const invalid = validatorHook({ code: "bad mockfi" });
  return {
    app: new Hono()
      .use(cors())
      .get("/v1/chains", async (c) =>
        c.json({
          chains: await Promise.all(
            [...sources.values()].map(async (source) => ({
              key: `mock${source.chain.id}`,
              chainType: "EVM",
              name: source.chain.name,
              coin: "ETH",
              id: source.chain.id,
              mainnet: true,
              logoURI,
              multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
              diamondAddress: source.swapper,
              nativeToken: await tokens(source).then((list) => list.find(({ address }) => address === zeroAddress)),
              metamask: {
                chainId: toHex(source.chain.id),
                blockExplorerUrls: [],
                chainName: source.chain.name,
                nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                rpcUrls: source.chain.rpcUrls.default.http,
              },
            })),
          ),
        }),
      )
      .get("/v1/tokens", vValidator("query", object({ chains: optional(string()) }), invalid), async (c) => {
        const { chains } = c.req.valid("query");
        const requested = chains?.split(",");
        return c.json({
          tokens: Object.fromEntries(
            await Promise.all(
              [...sources]
                .filter(([id]) => !requested || requested.includes(String(id)) || requested.includes(`mock${id}`))
                .map(async ([id, source]) => [id, await tokens(source)] as const),
            ),
          ),
        });
      })
      .get("/v1/token", vValidator("query", object({ chain: Network, token: Address }), invalid), async (c) => {
        const { chain: source, token } = c.req.valid("query");
        const found = await tokens(source).then((list) => list.find(({ address }) => address === token));
        return found ? c.json(found) : c.json({ code: 1003, message: "token not found" }, 404);
      })
      .get("/v1/tools", (c) =>
        c.json({
          bridges: [
            {
              ...tool,
              supportedChains: [...sources.keys()].flatMap((fromChainId) =>
                [...sources.keys()].filter((id) => id !== fromChainId).map((toChainId) => ({ fromChainId, toChainId })),
              ),
            },
          ],
          exchanges: [{ ...tool, supportedChains: [...sources.keys()] }],
        }),
      )
      .get("/v1/quote", vValidator("query", object({ ...Quote, fromAmount: Amount }), invalid), (c) => {
        const { fromAmount, ...query } = c.req.valid("query");
        return quote(query, { exact: "in", amount: fromAmount }).then((result) =>
          "code" in result ? c.json(result, 404) : c.json(result),
        );
      })
      .get("/v1/quote/toAmount", vValidator("query", object({ ...Quote, toAmount: Amount }), invalid), (c) => {
        const { toAmount, ...query } = c.req.valid("query");
        return quote(query, { exact: "out", amount: toAmount }).then((result) =>
          "code" in result ? c.json(result, 404) : c.json(result),
        );
      })
      .post(
        "/v1/quote/contractCalls",
        vValidator(
          "json",
          object({
            contractCalls: pipe(
              array(
                object({
                  fromAmount: Amount,
                  fromTokenAddress: Address,
                  toApprovalAddress: optional(Address),
                  toContractAddress: Address,
                  toContractCallData: Hex,
                  toContractGasLimit: Amount,
                }),
              ),
              minLength(1),
            ),
            fromAddress: Address,
            fromChain: Network,
            fromToken: Address,
            integrator: optional(string(), ""),
            slippage: optional(pipe(number(), minValue(0), maxValue(1)), 0.005),
            toAmount: Amount,
            toChain: Network,
            toFallbackAddress: optional(Address),
            toToken: Address,
          }),
          invalid,
        ),
        (c) => {
          const { contractCalls, toAmount, toFallbackAddress, ...query } = c.req.valid("json");
          return quote(
            { ...query, toAddress: toFallbackAddress },
            { exact: "out", amount: toAmount },
            contractCalls.map(
              ({ fromAmount, fromTokenAddress, toApprovalAddress, toContractAddress, toContractCallData }) => ({
                callTo: toContractAddress,
                approveTo: toApprovalAddress ?? toContractAddress,
                sendingAssetId: fromTokenAddress,
                receivingAssetId: fromTokenAddress,
                fromAmount,
                callData: toContractCallData,
                requiresDeposit: false,
              }),
            ),
          ).then((result) => ("code" in result ? c.json(result, 404) : c.json(result)));
        },
      )
      .get("/v1/status", vValidator("query", object({ fromChain: Network, txHash: Hash }), invalid), async (c) => {
        const { fromChain, txHash } = c.req.valid("query");
        const sending = { txHash, chainId: fromChain.chain.id };
        const receipt = await fromChain.client.getTransactionReceipt({ hash: txHash }).catch(() => undefined);
        if (receipt?.status === "reverted") return c.json({ status: "FAILED", tool: tool.key, sending });
        const logs = receipt?.logs ?? [];
        const [started] = parseEventLogs({ abi: mockSwapperAbi, logs, eventName: "LiFiTransferStarted" });
        if (!started) {
          const [swapped] = parseEventLogs({ abi: mockSwapperAbi, logs, eventName: "LiFiGenericSwapCompleted" });
          return c.json(
            swapped ? { status: "DONE", tool: tool.key, sending, receiving: sending } : { status: "NOT_FOUND" },
          );
        }
        const { transactionId, destinationChainId } = started.args.bridgeData;
        const [completion] = await database
          .select({ hash: bridgeCompletions.hash })
          .from(bridgeCompletions)
          .where(
            and(
              eq(bridgeCompletions.chainId, Number(destinationChainId)),
              eq(bridgeCompletions.transactionId, transactionId),
            ),
          )
          .limit(1);
        return c.json({
          transactionId,
          tool: tool.key,
          sending,
          ...(completion
            ? { status: "DONE", receiving: { txHash: completion.hash, chainId: Number(destinationChainId) } }
            : { status: "PENDING" }),
        });
      }),
    ready: Promise.resolve(),
  };

  async function tokens({ chain: { id }, client, exaPreviewer, swapper }: Source) {
    const markets = await client.readContract({ address: exaPreviewer, abi: exaPreviewerAbi, functionName: "markets" });
    const listed = markets.flatMap(({ asset, decimals, symbol, usdPrice }) => {
      const token = {
        address: asset,
        chainId: id,
        decimals,
        name: symbol,
        symbol,
        priceUSD: formatUnits(usdPrice, 18),
        logoURI,
      };
      return symbol === "WETH"
        ? [{ ...token, address: zeroAddress, name: "ETH", symbol: "ETH", coinKey: "ETH" }, token]
        : [token];
    });
    const usdc = markets.find(({ symbol }) => symbol === "USDC");
    const others = (allowlists[String(id)] ?? [])
      .map((address) => getAddress(address))
      .filter((address) => !markets.some(({ asset }) => asset === address));
    if (!usdc || others.length === 0) return listed;
    const factory = await client.readContract({
      address: swapper,
      abi: mockSwapperAbi,
      functionName: "VELODROME_FACTORY",
    });
    const priced = await Promise.all(
      others.map(async (address) => {
        const pool = await client.readContract({
          address: factory,
          abi: velodromeAbi,
          functionName: "getPool",
          args: [address, usdc.asset, false],
        });
        if (pool === zeroAddress) return [];
        const [symbol, decimals, reserve, usdcReserve] = await Promise.all([
          client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
          client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
          client.readContract({ address, abi: erc20Abi, functionName: "balanceOf", args: [pool] }),
          client.readContract({ address: usdc.asset, abi: erc20Abi, functionName: "balanceOf", args: [pool] }),
        ]);
        if (reserve === 0n || usdcReserve === 0n) return [];
        return [
          {
            address,
            chainId: id,
            decimals,
            name: symbol,
            symbol,
            priceUSD: formatUnits(
              (usdcReserve * usdc.usdPrice * 10n ** BigInt(decimals)) / (reserve * 10n ** BigInt(usdc.decimals)),
              18,
            ),
            logoURI,
          },
        ];
      }),
    );
    return [...listed, ...priced.flat()];
  }

  async function quote(
    {
      fromAddress,
      fromChain,
      fromToken,
      integrator,
      slippage,
      toAddress = fromAddress,
      toChain,
      toToken,
    }: {
      fromAddress: Address;
      fromChain: Source;
      fromToken: Address;
      integrator: string;
      slippage: number;
      toAddress?: Address;
      toChain: Source;
      toToken: Address;
    },
    { amount, exact }: { amount: bigint; exact: "in" | "out" },
    calls?: readonly {
      approveTo: Address;
      callData: Hex;
      callTo: Address;
      fromAmount: bigint;
      receivingAssetId: Address;
      requiresDeposit: boolean;
      sendingAssetId: Address;
    }[],
  ) {
    const { chain: source, client, swapper } = fromChain;
    const destination = toChain.chain;
    const [fromTokens, toTokens, price] = await Promise.all([tokens(fromChain), tokens(toChain), client.getGasPrice()]);
    const from = fromTokens.find(({ address }) => address === fromToken);
    const to = toTokens.find(({ address }) => address === toToken);
    if (!from || !to) return { code: 1003, message: "token not found" } as const;
    const native = fromTokens.find(({ address }) => address === zeroAddress);
    const cross = source.id !== destination.id;
    const qualifies = ({ symbol }: { symbol: string }) => symbol === to.symbol || symbol === counterparts[to.symbol];
    const via = cross ? (qualifies(from) ? from : fromTokens.find((token) => qualifies(token))) : to;
    if (!via || (calls && (!cross || to.address === zeroAddress))) return noQuote;
    const swap = via.address !== fromToken;
    const tolerance = BigInt(Math.round(slippage * 1e6));
    const limits = swap
      ? await client
          .readContract({
            address: swapper,
            abi: mockSwapperAbi,
            functionName: exact === "in" ? "getAmountOut" : "getAmountIn",
            args: [fromToken, amount, via.address],
          })
          .then(
            (quoted) =>
              exact === "in"
                ? {
                    fromAmount: amount,
                    toAmount: quoted,
                    toAmountMin: (quoted * (1_000_000n - tolerance)) / 1_000_000n,
                  }
                : {
                    fromAmount: (quoted * (1_000_000n + tolerance) + 999_999n) / 1_000_000n,
                    toAmount: amount,
                    toAmountMin: amount,
                  },
            () => undefined,
          )
      : { fromAmount: amount, toAmount: amount, toAmountMin: amount };
    if (!limits || limits.toAmount === 0n) return noQuote;
    const { fromAmount, toAmount, toAmountMin } = limits;
    const bridgeData = {
      transactionId: concatHex([to.address, toHex(crypto.getRandomValues(new Uint8Array(12)))]),
      bridge: tool.key,
      integrator,
      referrer: zeroAddress,
      sendingAssetId: via.address,
      receiver: toAddress,
      minAmount: toAmountMin,
      destinationChainId: BigInt(destination.id),
      hasSourceSwaps: swap,
      hasDestinationCall: calls !== undefined,
    };
    const message =
      calls &&
      encodeAbiParameters(
        [
          { type: "bytes32" },
          getAbiItem({ abi: mockSwapperAbi, name: "executeViaMock" }).inputs[2],
          { type: "address" },
        ],
        [bridgeData.transactionId, calls, toAddress],
      );
    const data = message
      ? swap
        ? encodeFunctionData({
            abi: mockSwapperAbi,
            functionName: "swapAndStartBridgeTokensAndCallViaMock",
            args: [bridgeData, fromToken, fromAmount, message],
          })
        : encodeFunctionData({
            abi: mockSwapperAbi,
            functionName: "startBridgeTokensAndCallViaMock",
            args: [bridgeData, message],
          })
      : cross
        ? swap
          ? encodeFunctionData({
              abi: mockSwapperAbi,
              functionName: "swapAndStartBridgeTokensViaMock",
              args: [bridgeData, fromToken, fromAmount],
            })
          : encodeFunctionData({ abi: mockSwapperAbi, functionName: "startBridgeTokensViaMock", args: [bridgeData] })
        : encodeFunctionData({
            abi: mockSwapperAbi,
            functionName: exact === "in" ? "swapExactAmountIn" : "swapExactAmountOut",
            args: [fromToken, fromAmount, toToken, toAmountMin, toAddress],
          });
    const action = {
      fromChainId: source.id,
      toChainId: destination.id,
      fromToken: from,
      toToken: to,
      fromAmount: String(fromAmount),
      fromAddress,
      toAddress,
      slippage,
    };
    const estimate = {
      tool: tool.key,
      fromAmount: String(fromAmount),
      fromAmountUSD: (Number(formatUnits(fromAmount, from.decimals)) * Number(from.priceUSD)).toFixed(2),
      toAmount: String(toAmount),
      toAmountUSD: (Number(formatUnits(toAmount, to.decimals)) * Number(to.priceUSD)).toFixed(2),
      toAmountMin: String(toAmountMin),
      approvalAddress: swapper,
      executionDuration: cross ? 60 : 1,
      feeCosts: [],
      gasCosts: [
        {
          type: "SEND",
          price: String(price),
          estimate: String(gas),
          limit: String((gas * 125n) / 100n),
          amount: String(gas * price),
          amountUSD: (Number(formatUnits(gas * price, 18)) * Number(native?.priceUSD)).toFixed(4),
          token: native,
        },
      ],
    };
    return {
      type: "lifi",
      id: crypto.randomUUID(),
      tool: tool.key,
      toolDetails: tool,
      action,
      estimate,
      includedSteps: [
        {
          id: crypto.randomUUID(),
          type: cross ? "cross" : "swap",
          tool: tool.key,
          toolDetails: tool,
          action,
          estimate,
        },
      ],
      transactionRequest: {
        from: fromAddress,
        to: swapper,
        chainId: source.id,
        data,
        value: toHex(from === native ? fromAmount : 0n),
      },
    };
  }
}

const Amount = pipe(string(), regex(/^\d+$/, "bad amount"), toBigint());
const noQuote = { code: 1002, message: "No available quotes for the requested transfer", errors: {} } as const;
const Slippage = pipe(string(), toNumber(), minValue(0), maxValue(1));
const counterparts: Readonly<Record<string, string | undefined>> = {
  ETH: "WETH",
  USDC: "USDC.e",
  "USDC.e": "USDC",
  WETH: "ETH",
};
const gas = 300_000n;
const logoURI = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/>")}`;
const tool = { key: "mock", name: "Mock", logoURI };
