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
  parse,
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

import chain, {
  alchemyChains,
  allowlists,
  chains,
  exaPreviewerAbi,
  mockSwapperAbi,
  peers,
} from "@exactly/common/generated/chain";
import { Address, Hash, Hex } from "@exactly/common/validation";
import { accounts } from "@exactly/plugin/deploy.json";

import { bridgeCompletions } from "../database/indexer";
import { alchemyClient } from "../utils/publicClient";
import validatorHook from "../utils/validatorHook";

import type * as schema from "../database/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const velodromeAbi = parseAbi(["function getPool(address tokenA, address tokenB, bool stable) view returns (address)"]);

export default function hook({ database, testnets }: { database: NodePgDatabase<typeof schema>; testnets?: boolean }) {
  if (!chain.testnet) throw new Error("mockfi outside testnets");
  const listing = new Map(
    [...alchemyChains.values()].flatMap((network) => {
      const contracts = network.smartAccount
        ? (chains.get(network.id) ?? (testnets ? peers.get(network.id) : undefined))
        : undefined;
      const swapper = contracts?.swapper ?? (network.mockfi && network.swapper);
      if (!swapper) return [];
      return [
        [
          network.id,
          {
            chain: network,
            client: alchemyClient({ ...network, nativeCurrency: currency({ chain: network }) }),
            exaPreviewer: contracts?.exaPreviewer,
            swapper,
          },
        ] as const,
      ];
    }),
  );
  type Listed = typeof listing extends ReadonlyMap<number, infer L> ? L : never;
  type Destination = Listed & { exaPreviewer: `0x${string}` };
  const destinations = new Map(
    [...listing].filter((entry): entry is [number, Destination] => entry[1].exaPreviewer !== undefined),
  );
  const Listed = supported(listing);
  const Destination = supported(destinations);
  const Quote = {
    fromAddress: Address,
    fromChain: Listed,
    fromToken: Address,
    fee: optional(pipe(Fraction, maxValue(0.1)), "0"),
    integrator: optional(string(), ""),
    slippage: optional(Fraction, "0.005"),
    toAddress: optional(Address),
    toChain: Destination,
    toToken: Address,
  };
  const invalid = validatorHook({ code: "bad mockfi" });
  return {
    app: new Hono()
      .use(cors())
      .get("/v1/chains", async (c) =>
        c.json({
          chains: await Promise.all(
            [...listing.values()].map(async (entry) => ({
              key: `mock${entry.chain.id}`,
              chainType: "EVM",
              name: entry.chain.name,
              coin: currency(entry).symbol,
              id: entry.chain.id,
              mainnet: true,
              multicallAddress: entry.chain.contracts?.multicall3?.address ?? "",
              diamondAddress: entry.swapper,
              nativeToken: await tokens(entry).then((list) => list.find(({ address }) => address === zeroAddress)),
              metamask: {
                chainId: toHex(entry.chain.id),
                blockExplorerUrls: [],
                chainName: entry.chain.name,
                nativeCurrency: currency(entry),
                rpcUrls: entry.chain.rpcUrls.default.http,
              },
            })),
          ),
        }),
      )
      .get("/v1/tokens", vValidator("query", object({ chains: optional(string()) }), invalid), async (c) => {
        const requested = c.req.valid("query").chains?.split(",");
        return c.json({
          tokens: Object.fromEntries(
            await Promise.all(
              [...listing]
                .filter(([id]) => !requested || requested.includes(String(id)) || requested.includes(`mock${id}`))
                .map(async ([id, entry]) => [id, await tokens(entry)] as const),
            ),
          ),
        });
      })
      .get("/v1/token", vValidator("query", object({ chain: Listed, token: Address }), invalid), async (c) => {
        const { chain: entry, token } = c.req.valid("query");
        const found = await tokens(entry).then((list) => list.find(({ address }) => address === token));
        return found ? c.json(found) : c.json({ code: 1003, message: "token not found" }, 404);
      })
      .get("/v1/tools", (c) =>
        c.json({
          bridges: [
            {
              ...tool,
              supportedChains: [...listing.keys()].flatMap((fromChainId) =>
                [...destinations.keys()]
                  .filter((id) => id !== fromChainId)
                  .map((toChainId) => ({ fromChainId, toChainId })),
              ),
            },
          ],
          exchanges: [{ ...tool, supportedChains: [...destinations.keys()] }],
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
            fromChain: Listed,
            fromToken: Address,
            fee: optional(pipe(number(), minValue(0), maxValue(0.1)), 0),
            integrator: optional(string(), ""),
            slippage: optional(pipe(number(), minValue(0), maxValue(1)), 0.005),
            toAmount: Amount,
            toChain: Destination,
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
      .get("/v1/status", vValidator("query", object({ fromChain: Listed, txHash: Hash }), invalid), async (c) => {
        const { fromChain, txHash } = c.req.valid("query");
        const sending = { txHash, chainId: fromChain.chain.id };
        const receipt = await fromChain.client.getTransactionReceipt({ hash: txHash }).catch(() => undefined);
        if (receipt?.status === "reverted") return c.json({ status: "FAILED", tool: tool.key, sending });
        const logs = receipt?.logs ?? [];
        const known = await tokens(fromChain);
        const fees = parseEventLogs({ abi: feeCollectorAbi, logs, eventName: "FeesCollected" });
        const feeCosts = known.flatMap((token) =>
          fees
            .filter(({ args }) => args.token === token.address)
            .map(({ args: { integratorFee, lifiFee } }) => cost(token, integratorFee, lifiFee)),
        );
        const [started] = parseEventLogs({ abi: mockSwapperAbi, logs, eventName: "LiFiTransferStarted" });
        if (!started) {
          const [swapped] = parseEventLogs({ abi: mockSwapperAbi, logs, eventName: "LiFiGenericSwapCompleted" });
          if (!swapped) return c.json({ status: "NOT_FOUND" });
          return c.json({
            transactionId: swapped.args.transactionId,
            status: "DONE",
            substatus: "COMPLETED", // cspell:ignore substatus
            substatusMessage: "The transfer is complete.",
            tool: tool.key,
            fromAddress: receipt?.from,
            toAddress: swapped.args.receiver,
            metadata: { integrator: swapped.args.integrator },
            feeCosts,
            sending: {
              ...sending,
              amount: String(swapped.args.fromAmount),
              token: known.find(({ address }) => address === swapped.args.fromAssetId),
            },
            receiving: {
              ...sending,
              amount: String(swapped.args.toAmount),
              token: known.find(({ address }) => address === swapped.args.toAssetId),
            },
          });
        }
        const { transactionId, destinationChainId, integrator, receiver } = started.args.bridgeData;
        const [completion] = await database
          .select({ hash: bridgeCompletions.hash, asset: bridgeCompletions.asset, amount: bridgeCompletions.amount })
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
          fromAddress: receipt?.from,
          toAddress: receiver,
          metadata: { integrator },
          feeCosts,
          sending,
          ...(completion
            ? {
                status: "DONE",
                substatus: "COMPLETED",
                substatusMessage: "The transfer is complete.",
                receiving: {
                  txHash: completion.hash,
                  chainId: Number(destinationChainId),
                  amount: String(completion.amount),
                  token: await tokens(parse(Listed, String(destinationChainId))).then((list) =>
                    list.find(({ address }) => address === getAddress(completion.asset)),
                  ),
                },
              }
            : {
                status: "PENDING",
                substatus: "WAIT_DESTINATION_TRANSACTION",
                substatusMessage: "The bridge is waiting for the destination transaction.",
              }),
        });
      }),
    ready: Promise.resolve(),
  };

  function supported<T extends Listed>(entries: ReadonlyMap<number, T>) {
    return pipe(
      union([string(), number()]),
      transform((id) => entries.get(Number(id))),
      custom<T>((entry) => entry !== undefined, "unsupported chain"),
    );
  }

  async function tokens(entry: Listed) {
    const { exaPreviewer, swapper } = entry;
    if (exaPreviewer) return marketTokens({ ...entry, exaPreviewer, swapper });
    const { decimals, name, symbol } = currency(entry);
    const home = destinations.get(chain.id);
    const priceUSD =
      symbol === "ETH" && home
        ? await marketTokens(home).then((list) => list.find(({ address }) => address === zeroAddress)?.priceUSD)
        : undefined;
    return [
      {
        address: zeroAddress,
        chainId: entry.chain.id,
        decimals,
        name,
        symbol,
        coinKey: symbol,
        priceUSD: priceUSD ?? "0",
      },
    ];
  }

  async function marketTokens({ chain: { id }, client, exaPreviewer, swapper }: Destination) {
    const markets = await client.readContract({ address: exaPreviewer, abi: exaPreviewerAbi, functionName: "markets" });
    const listed = markets.flatMap(({ asset, decimals, symbol, usdPrice }) => {
      const token = {
        address: asset,
        chainId: id,
        decimals,
        name: symbol,
        symbol,
        priceUSD: formatUnits(usdPrice, 18),
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
      fee,
      fromToken,
      integrator,
      slippage,
      toAddress = fromAddress,
      toChain,
      toToken,
    }: {
      fee: number;
      fromAddress: Address;
      fromChain: Listed;
      fromToken: Address;
      integrator: string;
      slippage: number;
      toAddress?: Address;
      toChain: Destination;
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
    const via = cross
      ? qualifies(from)
        ? from
        : (fromTokens.find(({ symbol }) => symbol === to.symbol) ?? fromTokens.find((token) => qualifies(token)))
      : to;
    if (!via || (calls && (!cross || to.address === zeroAddress))) return noQuote;
    const swap = via.address !== fromToken;
    const tolerance = BigInt(Math.round(slippage * 1e6));
    const integratorRate = BigInt(Math.round(fee * 1e6));
    const kept = 1_000_000n - lifiRate - integratorRate;
    const charge = (gross: bigint) => {
      const lifiFee = (gross * lifiRate) / 1_000_000n;
      const integratorFee = (gross * integratorRate) / 1_000_000n;
      return { fromAmount: gross, integratorFee, lifiFee, net: gross - lifiFee - integratorFee };
    };
    const convert = (functionName: "getAmountIn" | "getAmountOut", value: bigint) =>
      client
        .readContract({ address: swapper, abi: mockSwapperAbi, functionName, args: [fromToken, value, via.address] })
        .catch(() => undefined);
    const limits =
      exact === "in"
        ? await (async () => {
            const charged = charge(amount);
            const quoted = swap ? await convert("getAmountOut", charged.net) : charged.net;
            return (
              quoted !== undefined && {
                ...charged,
                toAmount: quoted,
                toAmountMin: swap ? (quoted * (1_000_000n - tolerance)) / 1_000_000n : quoted,
              }
            );
          })()
        : await (swap ? convert("getAmountIn", amount) : Promise.resolve(amount)).then(
            (needed) =>
              needed !== undefined && {
                ...charge(
                  ((swap ? (needed * (1_000_000n + tolerance) + 999_999n) / 1_000_000n : needed) * 1_000_000n) / kept,
                ),
                toAmount: amount,
                toAmountMin: amount,
              },
          );
    if (!limits || limits.toAmount === 0n || limits.lifiFee === 0n) return noQuote;
    const { fromAmount, integratorFee, lifiFee, net, toAmount, toAmountMin } = limits;
    const feeData = { integratorFee, lifiFee, integrator: collector(source.id) };
    const transactionId = cross
      ? concatHex([to.address, toHex(crypto.getRandomValues(new Uint8Array(12)))])
      : toHex(crypto.getRandomValues(new Uint8Array(32)));
    const bridgeData = {
      transactionId,
      bridge: tool.key,
      integrator,
      referrer: zeroAddress,
      sendingAssetId: via.address,
      receiver: toAddress,
      minAmount: toAmountMin,
      destinationChainId: BigInt(destination.id),
      hasSourceSwaps: true,
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
    const data = cross
      ? message
        ? encodeFunctionData({
            abi: mockSwapperAbi,
            functionName: "swapAndStartBridgeTokensAndCallViaMock",
            args: [bridgeData, fromToken, fromAmount, feeData, message],
          })
        : encodeFunctionData({
            abi: mockSwapperAbi,
            functionName: "swapAndStartBridgeTokensViaMock",
            args: [bridgeData, fromToken, fromAmount, feeData],
          })
      : encodeFunctionData({
          abi: mockSwapperAbi,
          functionName: "swapTokensViaMock",
          args: [transactionId, integrator, toAddress, fromToken, fromAmount, toToken, toAmountMin, feeData],
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
    const feeCosts = [cost(from, integratorFee, lifiFee)];
    const limit = (gas * 125n) / 100n;
    const estimate = {
      tool: tool.key,
      fromAmount: String(fromAmount),
      fromAmountUSD: usd(fromAmount, from),
      toAmount: String(toAmount),
      toAmountUSD: usd(toAmount, to),
      toAmountMin: String(toAmountMin),
      approvalAddress: swapper,
      executionDuration: cross ? 60 : 1,
      feeCosts,
      gasCosts: [
        {
          type: "SEND",
          price: String(price),
          estimate: String(gas),
          limit: String(limit),
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
          type: "protocol",
          tool: feeCollection.key,
          toolDetails: feeCollection,
          action: { ...action, toChainId: source.id, toToken: from },
          estimate: {
            tool: feeCollection.key,
            fromAmount: String(fromAmount),
            fromAmountUSD: usd(fromAmount, from),
            toAmount: String(net),
            toAmountUSD: usd(net, from),
            toAmountMin: String(net),
            approvalAddress: swapper,
            executionDuration: 0,
            feeCosts,
            gasCosts: [],
          },
        },
        {
          id: crypto.randomUUID(),
          type: cross ? "cross" : "swap",
          tool: tool.key,
          toolDetails: tool,
          action: { ...action, fromAmount: String(net) },
          estimate: { ...estimate, fromAmount: String(net), fromAmountUSD: usd(net, from), feeCosts: [] },
        },
      ],
      integrator,
      transactionId,
      transactionRequest: {
        from: fromAddress,
        to: swapper,
        chainId: source.id,
        data,
        value: toHex(from === native ? fromAmount : 0n),
        gasPrice: toHex(price),
        gasLimit: toHex(limit),
      },
    };
  }
}

function currency({
  chain: { nativeCurrency },
}: {
  chain: { nativeCurrency?: { decimals: number; name: string; symbol: string } };
}) {
  return nativeCurrency ?? { decimals: 18, name: "ETH", symbol: "ETH" };
}

function collector(chainId: number) {
  return getAddress(
    (accounts.collector as Readonly<Record<string, string | undefined>>)[String(chainId)] ?? accounts.collector.default,
  );
}

function cost(token: { decimals: number; priceUSD: string }, integratorFee: bigint, lifiFee: bigint) {
  const amount = integratorFee + lifiFee;
  const rate = (Number(amount) * Number(lifiRate)) / Number(lifiFee) / 1e6;
  return {
    name: "LIFI Fixed Fee",
    description: "Fixed LIFI fee, independent of any other fee",
    token,
    amount: String(amount),
    amountUSD: usd(amount, token),
    percentage: String(Number(rate.toFixed(6))),
    included: true,
    feeSplit: { integratorFee: String(integratorFee), lifiFee: String(lifiFee) },
  };
}

function usd(amount: bigint, { decimals, priceUSD }: { decimals: number; priceUSD: string }) {
  return (Number(formatUnits(amount, decimals)) * Number(priceUSD)).toFixed(2);
}

const Amount = pipe(string(), regex(/^\d+$/, "bad amount"), toBigint());
const noQuote = { code: 1002, message: "No available quotes for the requested transfer", errors: {} } as const;
const Fraction = pipe(string(), toNumber(), minValue(0), maxValue(1));
const counterparts: Readonly<Record<string, string | undefined>> = {
  ETH: "WETH",
  USDC: "USDC.e",
  "USDC.e": "USDC",
  WETH: "ETH",
};
const feeCollection = { key: "feeCollection", name: "Integrator Fee" };
const feeCollectorAbi = parseAbi([
  "event FeesCollected(address indexed token, address indexed integrator, uint256 integratorFee, uint256 lifiFee)",
]);
const gas = 300_000n;
const lifiRate = 2500n;
const tool = { key: "mock", name: "Mock" };
