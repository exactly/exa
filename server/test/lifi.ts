import { Hono } from "hono";
import {
  createPublicClient,
  encodeDeployData,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  keccak256,
  parseEventLogs,
  toHex,
  zeroAddress,
  type Chain,
  type Hash,
  type Hex,
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
      c.json({
        bridges: [
          {
            ...tool,
            supportedChains: chains.flatMap(({ id: fromChainId }) =>
              chains.filter(({ id }) => id !== fromChainId).map(({ id: toChainId }) => ({ fromChainId, toChainId })),
            ),
          },
        ],
        exchanges: [{ ...tool, supportedChains: chains.map(({ id }) => id) }],
      }),
    )
    .get("/v1/quote/:direction?", async (c) => {
      const query = c.req.query();
      const fromChain = Number(query.fromChain);
      const toChain = Number(query.toChain);
      const fromToken = getAddress(query.fromToken ?? "");
      const toToken = getAddress(query.toToken ?? "");
      const fromAddress = getAddress(query.fromAddress ?? "");
      const toAddress = getAddress(query.toAddress ?? fromAddress);
      const exact = c.req.param("direction") === "toAmount" ? "out" : "in";
      const source = client(fromChain);
      const [fromTokens, toTokens] = await Promise.all([tokens(fromChain), tokens(toChain)]);
      const from = fromTokens.find(({ address }) => address === fromToken);
      const to = toTokens.find(({ address }) => address === toToken);
      let fromAmount: bigint;
      let toAmount: bigint;
      let data: Hex;
      if (fromChain === toChain) {
        if (exact === "in") {
          fromAmount = BigInt(query.fromAmount ?? "0");
          toAmount = await source.readContract({
            address: swapperAddress,
            abi: mockSwapperAbi,
            functionName: "getAmountOut",
            args: [fromToken, fromAmount, toToken],
          });
          data = encodeFunctionData({
            abi: mockSwapperAbi,
            functionName: "swapExactAmountIn",
            args: [fromToken, fromAmount, toToken, toAmount, toAddress],
          });
        } else {
          toAmount = BigInt(query.toAmount ?? "0");
          fromAmount = await source.readContract({
            address: swapperAddress,
            abi: mockSwapperAbi,
            functionName: "getAmountIn",
            args: [fromToken, toAmount, toToken],
          });
          data = encodeFunctionData({
            abi: mockSwapperAbi,
            functionName: "swapExactAmountOut",
            args: [fromToken, fromAmount, toToken, toAmount, toAddress],
          });
        }
      } else {
        const bridged = fromTokens.find(
          ({ symbol }) =>
            (to?.symbol === "USDC" && symbol === "USDC.e") || (to?.symbol === "USDC.e" && symbol === "USDC"),
        );
        if (!from || !bridged) {
          return c.json({ code: 1002, message: "No available quotes for the requested transfer", errors: {} }, 404);
        }
        if (bridged.address === fromToken) {
          fromAmount = BigInt((exact === "in" ? query.fromAmount : query.toAmount) ?? "0");
          toAmount = fromAmount;
        } else if (exact === "in") {
          fromAmount = BigInt(query.fromAmount ?? "0");
          toAmount = await source.readContract({
            address: swapperAddress,
            abi: mockSwapperAbi,
            functionName: "getAmountOut",
            args: [fromToken, fromAmount, bridged.address],
          });
        } else {
          toAmount = BigInt(query.toAmount ?? "0");
          fromAmount = await source.readContract({
            address: swapperAddress,
            abi: mockSwapperAbi,
            functionName: "getAmountIn",
            args: [fromToken, toAmount, bridged.address],
          });
        }
        const bridgeData = {
          transactionId: keccak256(toHex(`${fromChain}:${fromAddress}:${Date.now()}:${Math.random()}`)),
          bridge: "mock",
          integrator: query.integrator ?? "",
          referrer: zeroAddress,
          sendingAssetId: bridged.address,
          receiver: toAddress,
          minAmount: toAmount,
          destinationChainId: BigInt(toChain),
          hasSourceSwaps: bridged.address !== fromToken,
          hasDestinationCall: false,
        };
        data =
          bridged.address === fromToken
            ? encodeFunctionData({ abi: mockSwapperAbi, functionName: "startBridgeTokensViaMock", args: [bridgeData] })
            : encodeFunctionData({
                abi: mockSwapperAbi,
                functionName: "swapAndStartBridgeTokensViaMock",
                args: [bridgeData, fromToken, fromAmount],
              });
      }
      const action = {
        fromChainId: fromChain,
        toChainId: toChain,
        fromToken: from,
        toToken: to,
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
        includedSteps: [
          {
            id: crypto.randomUUID(),
            type: fromChain === toChain ? "swap" : "cross",
            tool: tool.key,
            toolDetails: tool,
            action,
            estimate,
          },
        ],
        transactionRequest: { from: fromAddress, to: swapperAddress, chainId: fromChain, data, value: "0x0" },
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
        const [started] = parseEventLogs({ abi: mockSwapperAbi, eventName: "LiFiTransferStarted", logs: receipt.logs });
        const sending = { txHash, chainId: id };
        if (!started) {
          const [swapped] = parseEventLogs({
            abi: mockSwapperAbi,
            eventName: "LiFiGenericSwapCompleted",
            logs: receipt.logs,
          });
          return c.json(
            swapped ? { status: "DONE", tool: tool.key, sending, receiving: sending } : { status: "NOT_FOUND" },
          );
        }
        const { transactionId, destinationChainId } = started.args.bridgeData;
        const [completed] = await client(Number(destinationChainId)).getContractEvents({
          address: swapperAddress,
          abi: mockSwapperAbi,
          eventName: "LiFiTransferCompleted",
          args: { transactionId },
          fromBlock: 0n,
        });
        return c.json({
          transactionId,
          status: completed ? "DONE" : "PENDING",
          tool: tool.key,
          sending,
          ...(completed && { receiving: { txHash: completed.transactionHash, chainId: Number(destinationChainId) } }),
        });
      }
      return c.json({ status: "NOT_FOUND" });
    });
}
