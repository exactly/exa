import { Hono } from "hono";
import {
  createPublicClient,
  encodeDeployData,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  parseEventLogs,
  toHex,
  zeroAddress,
  type Chain,
  type Hash,
} from "viem";

import {
  auditorAddress,
  exaPreviewerAbi,
  exaPreviewerCode,
  marketUSDCAddress,
  marketWETHAddress,
  mockSwapperAbi,
  proposalManagerAddress,
  swapperAddress,
} from "@exactly/common/generated/chain";

const logoURI = `data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/>")}`;
const tool = { key: "mock", name: "Mock", logoURI };

export default function lifi(chains: readonly Chain[]) {
  const clients = new Map(chains.map((chain) => [chain.id, createPublicClient({ chain, transport: http() })]));
  function client(id: number | string | undefined) {
    const found = clients.get(Number(id));
    if (!found) throw new Error(`unknown chain ${id}`);
    return found;
  }
  async function tokens(id: number) {
    const markets = await client(id).readContract({
      abi: exaPreviewerAbi,
      functionName: "markets",
      code: encodeDeployData({
        abi: exaPreviewerAbi,
        bytecode: exaPreviewerCode,
        args: [auditorAddress, marketUSDCAddress, proposalManagerAddress],
      }),
    });
    return markets.flatMap(({ asset, decimals, market, symbol, usdPrice }) => {
      const token = {
        address: asset,
        chainId: id,
        decimals,
        name: symbol,
        symbol,
        priceUSD: formatUnits(usdPrice, 18),
        logoURI,
      };
      return market === marketWETHAddress
        ? [token, { ...token, address: zeroAddress, name: "ETH", symbol: "ETH", coinKey: "ETH" }]
        : [token];
    });
  }
  return new Hono()
    .get("/v1/chains", (c) =>
      c.json({
        chains: chains.map(({ id, name, rpcUrls }) => ({
          key: `local${id}`,
          chainType: "EVM",
          name,
          coin: "ETH",
          id,
          mainnet: true,
          logoURI,
          multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
          diamondAddress: swapperAddress,
          nativeToken: {
            address: zeroAddress,
            chainId: id,
            symbol: "ETH",
            decimals: 18,
            name: "ETH",
            coinKey: "ETH",
            priceUSD: "0",
            logoURI,
          },
          metamask: {
            chainId: toHex(id),
            blockExplorerUrls: [],
            chainName: name,
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: rpcUrls.default.http,
          },
        })),
      }),
    )
    .get("/v1/tokens", async (c) =>
      c.json({
        tokens: Object.fromEntries(await Promise.all(chains.map(async ({ id }) => [id, await tokens(id)] as const))),
      }),
    )
    .get("/v1/token", async (c) => {
      const token = await tokens(Number(c.req.query("chain"))).then((list) =>
        list.find(({ address }) => address.toLowerCase() === c.req.query("token")?.toLowerCase()),
      );
      return token ? c.json(token) : c.json({ code: 1003, message: "token not found" }, 404);
    })
    .get("/v1/tools", (c) =>
      c.json({ bridges: [], exchanges: [{ ...tool, supportedChains: chains.map(({ id }) => id) }] }),
    )
    .get("/v1/quote/:direction?", async (c) => {
      const query = c.req.query();
      const chainId = Number(query.fromChain);
      if (Number(query.toChain) !== chainId) {
        return c.json({ code: 1002, message: "No available quotes for the requested transfer", errors: {} }, 404);
      }
      const fromToken = getAddress(query.fromToken ?? "");
      const toToken = getAddress(query.toToken ?? "");
      const fromAddress = getAddress(query.fromAddress ?? "");
      const toAddress = getAddress(query.toAddress ?? fromAddress);
      const exact = c.req.param("direction") === "toAmount";
      const source = client(chainId);
      const fromAmount = exact
        ? await source.readContract({
            address: swapperAddress,
            abi: mockSwapperAbi,
            functionName: "getAmountIn",
            args: [fromToken, BigInt(query.toAmount ?? "0"), toToken],
          })
        : BigInt(query.fromAmount ?? "0");
      const toAmount = exact
        ? BigInt(query.toAmount ?? "0")
        : await source.readContract({
            address: swapperAddress,
            abi: mockSwapperAbi,
            functionName: "getAmountOut",
            args: [fromToken, fromAmount, toToken],
          });
      const listed = await tokens(chainId);
      const action = {
        fromChainId: chainId,
        toChainId: chainId,
        fromToken: listed.find(({ address }) => address === fromToken),
        toToken: listed.find(({ address }) => address === toToken),
        fromAmount: String(fromAmount),
        fromAddress,
        toAddress,
        slippage: Number(query.slippage ?? 0),
      };
      const estimate = {
        tool: tool.key,
        fromAmount: String(fromAmount),
        toAmount: String(toAmount),
        toAmountMin: String(toAmount),
        approvalAddress: swapperAddress,
        executionDuration: 1,
        feeCosts: [],
        gasCosts: [],
      };
      return c.json({
        type: "lifi",
        id: crypto.randomUUID(),
        tool: tool.key,
        toolDetails: tool,
        action,
        estimate,
        includedSteps: [{ id: crypto.randomUUID(), type: "swap", tool: tool.key, toolDetails: tool, action, estimate }],
        transactionRequest: {
          from: fromAddress,
          to: swapperAddress,
          chainId,
          data: encodeFunctionData({
            abi: mockSwapperAbi,
            functionName: exact ? "swapExactAmountOut" : "swapExactAmountIn",
            args: [fromToken, fromAmount, toToken, toAmount, toAddress],
          }),
          value: "0x0",
        },
      });
    })
    .get("/v1/status", async (c) => {
      const txHash = c.req.query("txHash") as Hash;
      const ids = c.req.query("fromChain") ? [Number(c.req.query("fromChain"))] : chains.map(({ id }) => id);
      for (const id of ids) {
        const receipt = await client(id)
          .getTransactionReceipt({ hash: txHash })
          .catch(() => undefined);
        if (!receipt) continue;
        const [swapped] = parseEventLogs({
          abi: mockSwapperAbi,
          eventName: "LiFiGenericSwapCompleted",
          logs: receipt.logs,
        });
        const sending = { txHash, chainId: id };
        return c.json(
          swapped ? { status: "DONE", tool: tool.key, sending, receiving: sending } : { status: "NOT_FOUND" },
        );
      }
      return c.json({ status: "NOT_FOUND" });
    });
}
