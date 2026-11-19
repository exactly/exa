import "../mocks/sentry";

import { captureException } from "@sentry/node";
import {
  createTestClient,
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAbiItem,
  getAddress,
  http,
  keccak256,
  maxUint256,
  padHex,
  parseAbi,
  parseUnits,
  publicActions,
  toHex,
  walletActions,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anvil, baseSepolia, moonbeamDev, optimism, optimismSepolia } from "viem/chains";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  marketAbi,
  marketUSDCAddress,
  marketWETHAddress,
  mockSwapperAbi,
  swapperAddress,
  usdcAddress,
} from "@exactly/common/generated/chain";
import { accounts } from "@exactly/plugin/deploy.json";

import database from "../../database";
import createMockfi from "../../hooks/mockfi";

import type * as Chain from "@exactly/common/generated/chain";

const { app } = createMockfi({ database });
const mintAbi = parseAbi(["function mint(address to, uint256 value)"]);
const feeCollectorAbi = parseAbi([
  "function getTokenBalance(address integrator, address token) view returns (uint256)",
  "function getLifiTokenBalance(address token) view returns (uint256)",
]);
const account = privateKeyToAccount(generatePrivateKey());
const clients = new Map(
  [anvil, { ...moonbeamDev, name: "Anvil2" }].map(
    (chain) =>
      [
        chain.id as number,
        createTestClient({ account, chain, mode: "anvil", transport: http() })
          .extend(publicActions)
          .extend(walletActions),
      ] as const,
  ),
);

type Token = { address: Address; chainId: number; decimals: number; priceUSD: string; symbol: string };
let tokens: Record<number, Token[]>;

function token(chainId: number, symbol: string) {
  const found = tokens[chainId]?.find((t) => t.symbol === symbol);
  if (!found) throw new Error(`missing ${symbol} on ${chainId}`);
  return found;
}

function client(chainId: number) {
  const found = clients.get(chainId);
  if (!found) throw new Error(`missing client ${chainId}`);
  return found;
}

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- response shape per endpoint
async function get<T = Record<string, unknown>>(path: string, body?: unknown) {
  const response = await app.request(
    path,
    body === undefined
      ? undefined
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  return { status: response.status, body: (await response.json()) as T };
}

type Quote = {
  action: { fromAddress: Address; toAddress: Address };
  estimate: {
    approvalAddress: Address;
    feeCosts: { amount: string; feeSplit: { integratorFee: string; lifiFee: string } }[];
    fromAmount: string;
    toAmount: string;
    toAmountMin: string;
  };
  includedSteps: { estimate: { fromAmount: string; toAmount: string }; tool: string; type: string }[];
  transactionRequest: { chainId: number; data: Hex; from: Address; to: Address; value: Hex };
  type: string;
};

async function execute({ estimate, transactionRequest, action }: Quote, from: Address) {
  const sender = client(transactionRequest.chainId);
  if (from === zeroAddress) {
    expect(BigInt(transactionRequest.value)).toBe(BigInt(estimate.fromAmount));
    const hash = await sender.sendTransaction({
      to: transactionRequest.to,
      data: transactionRequest.data,
      value: BigInt(transactionRequest.value),
    });
    await expect(sender.waitForTransactionReceipt({ hash })).resolves.toMatchObject({ status: "success" });
    return hash;
  }
  expect(transactionRequest.value).toBe("0x0");
  await sender.waitForTransactionReceipt({
    hash: await sender.writeContract({
      address: from,
      abi: mintAbi,
      functionName: "mint",
      args: [account.address, BigInt(estimate.fromAmount)],
    }),
  });
  await sender.waitForTransactionReceipt({
    hash: await sender.writeContract({
      address: from,
      abi: erc20Abi,
      functionName: "approve",
      args: [estimate.approvalAddress, BigInt(estimate.fromAmount)],
    }),
  });
  const hash = await sender.sendTransaction({ to: transactionRequest.to, data: transactionRequest.data });
  const receipt = await sender.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  expect(action.fromAddress).toBe(account.address);
  return hash;
}

function balanceOf(chainId: number, asset: Address, owner: Address) {
  return asset === zeroAddress
    ? client(chainId).getBalance({ address: owner })
    : client(chainId).readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [owner] });
}

function quote(params: Record<string, bigint | number | string>, exact: "fromAmount" | "toAmount" = "fromAmount") {
  return get<Quote>(
    `/v1/quote${exact === "toAmount" ? "/toAmount" : ""}?${String(
      new URLSearchParams({
        fromAddress: account.address,
        ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
      }),
    )}`,
  );
}

function fresh() {
  return privateKeyToAccount(generatePrivateKey()).address;
}

function lifiFee(amount: bigint) {
  return (amount * 2500n) / 1_000_000n;
}

function gross(amount: bigint, rate = 2500n) {
  return (amount * 1_000_000n) / (1_000_000n - rate);
}

async function collected(asset: Address, integrator?: Address) {
  const collector = await client(anvil.id).readContract({
    address: swapperAddress,
    abi: mockSwapperAbi,
    functionName: "FEE_COLLECTOR",
  });
  return integrator
    ? client(anvil.id).readContract({
        address: collector,
        abi: feeCollectorAbi,
        functionName: "getTokenBalance",
        args: [integrator, asset],
      })
    : client(anvil.id).readContract({
        address: collector,
        abi: feeCollectorAbi,
        functionName: "getLifiTokenBalance",
        args: [asset],
      });
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeAll(async () => {
  await Promise.all([...clients.values()].map((c) => c.setBalance({ address: account.address, value: 10n ** 20n })));
  const { body } = await get<{ tokens: Record<number, Token[]> }>("/v1/tokens");
  tokens = body.tokens;
});

describe("chains", () => {
  it("lists every network with its diamond", async () => {
    const { status, body } = await get<{
      chains: { diamondAddress: Address; id: number; multicallAddress: string; nativeToken: Token }[];
    }>("/v1/chains");

    expect(status).toBe(200);
    expect(body.chains.map(({ id, diamondAddress }) => [id, diamondAddress])).toStrictEqual([
      [anvil.id, swapperAddress],
      [moonbeamDev.id, swapperAddress],
    ]);
    expect(body.chains.map(({ multicallAddress }) => multicallAddress)).toStrictEqual([
      optimism.contracts.multicall3.address,
      optimism.contracts.multicall3.address,
    ]);
    expect(body.chains.map(({ nativeToken }) => nativeToken.address)).toStrictEqual([zeroAddress, zeroAddress]);
  });
});

describe("tokens", () => {
  it("lists market tokens, native eth and allowlisted tokens with prices", () => {
    expect(Object.keys(tokens)).toStrictEqual([String(moonbeamDev.id), String(anvil.id)]);
    expect(token(anvil.id, "ETH").address).toBe(zeroAddress);
    expect(Number(token(anvil.id, "USDT").priceUSD)).toBeGreaterThan(0);
    expect(token(anvil.id, "USDC").priceUSD).toBe("1");
  });

  it("filters by chain id or key", async () => {
    await expect(get(`/v1/tokens?chains=${anvil.id}`)).resolves.toStrictEqual({
      status: 200,
      body: { tokens: { [anvil.id]: tokens[anvil.id] } },
    });
    await expect(get(`/v1/tokens?chains=mock${moonbeamDev.id},10`)).resolves.toStrictEqual({
      status: 200,
      body: { tokens: { [moonbeamDev.id]: tokens[moonbeamDev.id] } },
    });
  });

  it("finds a token", async () => {
    const usdc = token(anvil.id, "USDC");

    await expect(get(`/v1/token?chain=${anvil.id}&token=${usdc.address}`)).resolves.toStrictEqual({
      status: 200,
      body: usdc,
    });
  });

  it("returns not found for an unknown token", async () => {
    await expect(get(`/v1/token?chain=${anvil.id}&token=${padHex("0x1", { size: 20 })}`)).resolves.toStrictEqual({
      status: 404,
      body: { code: 1003, message: "token not found" },
    });
  });

  it("rejects unsupported chains", async () => {
    const { status, body } = await get(`/v1/token?chain=10&token=${zeroAddress}`);

    expect(status).toBe(400);
    expect(body).toMatchObject({ code: "bad mockfi" });
    expectInvalid();
  });
});

describe("tools", () => {
  it("lists the mock bridge between every pair of networks", async () => {
    await expect(get("/v1/tools")).resolves.toMatchObject({
      status: 200,
      body: {
        bridges: [
          {
            key: "mock",
            supportedChains: [
              { fromChainId: anvil.id, toChainId: moonbeamDev.id },
              { fromChainId: moonbeamDev.id, toChainId: anvil.id },
            ],
          },
        ],
        exchanges: [{ key: "mock", supportedChains: [anvil.id, moonbeamDev.id] }],
      },
    });
  });
});

describe("testnets", () => {
  it("bridges between the local networks and the shared testnets", async () => {
    const response = await createMockfi({ database, testnets: true }).app.request("/v1/tools");
    const { bridges } = (await response.json()) as {
      bridges: { supportedChains: { fromChainId: number; toChainId: number }[] }[];
    };

    expect(bridges[0]?.supportedChains).toStrictEqual(
      expect.arrayContaining([
        { fromChainId: anvil.id, toChainId: optimismSepolia.id },
        { fromChainId: optimismSepolia.id, toChainId: anvil.id },
        { fromChainId: moonbeamDev.id, toChainId: baseSepolia.id },
        { fromChainId: baseSepolia.id, toChainId: moonbeamDev.id },
      ]),
    );
  });
});

describe("quote", () => {
  it("swaps an exact input on the same network", async () => {
    const usdc = token(anvil.id, "USDC");
    const weth = token(anvil.id, "WETH");
    const receiver = fresh();
    const { status, body } = await quote({
      fromChain: anvil.id,
      toChain: anvil.id,
      fromToken: usdc.address,
      toToken: weth.address,
      toAddress: receiver,
      fromAmount: parseUnits("100", 6),
    });

    const fromAmount = parseUnits("100", 6);
    const fee = lifiFee(fromAmount);
    expect(status).toBe(200);
    expect(body.includedSteps).toMatchObject([
      {
        type: "protocol",
        tool: "feeCollection",
        estimate: { fromAmount: String(fromAmount), toAmount: String(fromAmount - fee) },
      },
      { type: "swap", estimate: { fromAmount: String(fromAmount - fee), toAmount: body.estimate.toAmount } },
    ]);
    expect(body.estimate.feeCosts).toMatchObject([
      {
        name: "LIFI Fixed Fee",
        amount: String(fee),
        percentage: "0.0025",
        included: true,
        feeSplit: { integratorFee: "0", lifiFee: String(fee) },
      },
    ]);
    expect(body.action).toMatchObject({ toAddress: receiver, slippage: 0.005 });
    expect(BigInt(body.estimate.toAmountMin)).toBe((BigInt(body.estimate.toAmount) * 995n) / 1000n);
    await expect(
      client(anvil.id).readContract({
        address: swapperAddress,
        abi: mockSwapperAbi,
        functionName: "getAmountOut",
        args: [usdc.address, fromAmount - fee, weth.address],
      }),
    ).resolves.toBe(BigInt(body.estimate.toAmount));
    const before = await balanceOf(anvil.id, usdc.address, account.address);
    const fees = await collected(usdc.address);
    const hash = await execute(body, usdc.address);
    await expect(collected(usdc.address)).resolves.toBe(fees + fee);
    await expect(balanceOf(anvil.id, weth.address, receiver)).resolves.toBe(BigInt(body.estimate.toAmount));
    await expect(balanceOf(anvil.id, usdc.address, account.address)).resolves.toBe(before);
    await expect(get(`/v1/status?fromChain=${anvil.id}&txHash=${hash}`)).resolves.toMatchObject({
      status: 200,
      body: {
        status: "DONE",
        substatus: "COMPLETED", // cspell:ignore substatus
        fromAddress: account.address.toLowerCase(),
        toAddress: receiver,
        feeCosts: [{ amount: String(fee), percentage: "0.0025", token: usdc }],
        sending: { txHash: hash, chainId: anvil.id, amount: body.estimate.fromAmount, token: usdc },
        receiving: { txHash: hash, chainId: anvil.id, amount: body.estimate.toAmount, token: weth },
      },
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("swaps an exact output on the same network", async () => {
    const usdc = token(anvil.id, "USDC");
    const weth = token(anvil.id, "WETH");
    const receiver = privateKeyToAccount(generatePrivateKey()).address;
    const toAmount = parseUnits("0.01", 18);
    const { status, body } = await get<Quote>(
      `/v1/quote/toAmount?fromChain=${anvil.id}&toChain=${anvil.id}&fromToken=${usdc.address}&toToken=${weth.address}&fromAddress=${account.address}&toAddress=${receiver}&toAmount=${toAmount}`,
    );

    expect(status).toBe(200);
    expect(body.estimate).toMatchObject({ toAmount: String(toAmount), toAmountMin: String(toAmount) });
    const quoted = await client(anvil.id).readContract({
      address: swapperAddress,
      abi: mockSwapperAbi,
      functionName: "getAmountIn",
      args: [usdc.address, toAmount, weth.address],
    });
    expect(BigInt(body.estimate.fromAmount)).toBe(gross((quoted * 1_005_000n + 999_999n) / 1_000_000n));
    const before = await balanceOf(anvil.id, usdc.address, account.address);
    await execute(body, usdc.address);
    await expect(balanceOf(anvil.id, weth.address, receiver)).resolves.toBeGreaterThanOrEqual(toAmount);
    await expect(balanceOf(anvil.id, usdc.address, account.address)).resolves.toBe(before);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("routes through usdc when there is no direct pool", async () => {
    const usdt = token(anvil.id, "USDT");
    const weth = token(anvil.id, "WETH");
    const receiver = fresh();
    const exactIn = await quote({
      fromChain: anvil.id,
      toChain: anvil.id,
      fromToken: usdt.address,
      toToken: weth.address,
      toAddress: receiver,
      fromAmount: parseUnits("50", 6),
    });
    const exactOut = await quote(
      {
        fromChain: anvil.id,
        toChain: anvil.id,
        fromToken: usdt.address,
        toToken: weth.address,
        toAddress: receiver,
        toAmount: parseUnits("0.001", 18),
      },
      "toAmount",
    );

    expect(exactIn.status).toBe(200);
    expect(exactOut.status).toBe(200);
    await execute(exactIn.body, usdt.address);
    await execute(exactOut.body, usdt.address);
    await expect(balanceOf(anvil.id, weth.address, receiver)).resolves.toBeGreaterThanOrEqual(
      BigInt(exactIn.body.estimate.toAmount) + parseUnits("0.001", 18),
    );
  });

  it("applies the requested slippage", async () => {
    const usdc = token(anvil.id, "USDC");
    const weth = token(anvil.id, "WETH");
    const { body } = await quote({
      fromChain: anvil.id,
      toChain: anvil.id,
      fromToken: usdc.address,
      toToken: weth.address,
      fromAmount: parseUnits("10", 6),
      slippage: "0.03",
    });

    expect(body.action).toMatchObject({ slippage: 0.03 });
    expect(BigInt(body.estimate.toAmountMin)).toBe((BigInt(body.estimate.toAmount) * 97n) / 100n);
    expect(decodeFunctionData({ abi: mockSwapperAbi, data: body.transactionRequest.data }).args[6]).toBe(
      BigInt(body.estimate.toAmountMin),
    );
  });

  it("collects the integrator fee", async () => {
    const usdc = token(anvil.id, "USDC");
    const weth = token(anvil.id, "WETH");
    const fromAmount = parseUnits("20", 6);
    const integratorFee = (fromAmount * 2500n) / 1_000_000n;
    const collector = getAddress(accounts.collector[anvil.id]);
    const { status, body } = await quote({
      fromChain: anvil.id,
      toChain: anvil.id,
      fromToken: usdc.address,
      toToken: weth.address,
      fromAmount,
      fee: "0.0025",
      integrator: "exa_app",
    });

    expect(status).toBe(200);
    expect(body.estimate.feeCosts).toMatchObject([
      {
        amount: String(integratorFee + lifiFee(fromAmount)),
        percentage: "0.005",
        feeSplit: { integratorFee: String(integratorFee), lifiFee: String(lifiFee(fromAmount)) },
      },
    ]);
    const before = await collected(usdc.address, collector);
    const hash = await execute(body, usdc.address);
    await expect(collected(usdc.address, collector)).resolves.toBe(before + integratorFee);
    await expect(get(`/v1/status?fromChain=${anvil.id}&txHash=${hash}`)).resolves.toMatchObject({
      body: { metadata: { integrator: "exa_app" }, feeCosts: [{ percentage: "0.005" }] },
    });
  });

  it("swaps native ether", async () => {
    const usdc = token(anvil.id, "USDC");
    const receiver = fresh();
    const { status, body } = await quote({
      fromChain: anvil.id,
      toChain: anvil.id,
      fromToken: zeroAddress,
      toToken: usdc.address,
      toAddress: receiver,
      fromAmount: parseUnits("0.01", 18),
    });

    expect(status).toBe(200);
    await execute(body, zeroAddress);
    await expect(balanceOf(anvil.id, usdc.address, receiver)).resolves.toBe(BigInt(body.estimate.toAmount));
  });

  it("delivers native ether", async () => {
    const usdc = token(anvil.id, "USDC");
    const receiver = fresh();
    const { status, body } = await quote({
      fromChain: anvil.id,
      toChain: anvil.id,
      fromToken: usdc.address,
      toToken: zeroAddress,
      toAddress: receiver,
      fromAmount: parseUnits("10", 6),
    });

    expect(status).toBe(200);
    await execute(body, usdc.address);
    await expect(balanceOf(anvil.id, zeroAddress, receiver)).resolves.toBe(BigInt(body.estimate.toAmount));
  });

  it("wraps native ether", async () => {
    const weth = token(anvil.id, "WETH");
    const receiver = fresh();
    const amount = parseUnits("0.01", 18);
    const { body } = await quote({
      fromChain: anvil.id,
      toChain: anvil.id,
      fromToken: zeroAddress,
      toToken: weth.address,
      toAddress: receiver,
      fromAmount: amount,
    });

    const net = amount - lifiFee(amount);
    expect(body.estimate).toMatchObject({ toAmount: String(net), toAmountMin: String((net * 995n) / 1000n) });
    await execute(body, zeroAddress);
    await expect(balanceOf(anvil.id, weth.address, receiver)).resolves.toBe(net);
  });

  it("returns no quotes beyond the pool liquidity", async () => {
    const usdc = token(anvil.id, "USDC");
    const weth = token(anvil.id, "WETH");

    await expect(
      quote(
        {
          fromChain: anvil.id,
          toChain: anvil.id,
          fromToken: usdc.address,
          toToken: weth.address,
          toAmount: 10n ** 30n,
        },
        "toAmount",
      ),
    ).resolves.toStrictEqual({
      status: 404,
      body: { code: 1002, message: "No available quotes for the requested transfer", errors: {} },
    });
  });

  it("bridges the same asset and reports pending until delivered", async () => {
    const usdc = token(anvil.id, "USDC");
    const destination = token(moonbeamDev.id, "USDC");
    const amount = parseUnits("10", 6);
    const { status, body } = await get<Quote>(
      `/v1/quote?fromChain=${anvil.id}&toChain=${moonbeamDev.id}&fromToken=${usdc.address}&toToken=${destination.address}&fromAddress=${account.address}&fromAmount=${amount}`,
    );

    expect(status).toBe(200);
    expect(body.includedSteps).toMatchObject([{ type: "protocol" }, { type: "cross" }]);
    expect(body.estimate).toMatchObject({ fromAmount: String(amount), toAmount: String(amount - lifiFee(amount)) });
    const hash = await execute(body, usdc.address);
    const statusPath = `/v1/status?fromChain=${anvil.id}&txHash=${hash}`;
    const { body: pending } = await get<{ status: string; transactionId: Hash }>(statusPath);

    expect(pending).toMatchObject({
      status: "PENDING",
      substatus: "WAIT_DESTINATION_TRANSACTION",
      feeCosts: [{ amount: String(lifiFee(amount)) }],
      metadata: { integrator: "exa_app" },
    });
    expect(pending.transactionId.slice(0, 42)).toBe(destination.address.toLowerCase());
  });

  it("bridges native ether", async () => {
    const amount = parseUnits("0.001", 18);
    const { status, body } = await quote({
      fromChain: anvil.id,
      toChain: moonbeamDev.id,
      fromToken: zeroAddress,
      toToken: zeroAddress,
      fromAmount: amount,
    });

    expect(status).toBe(200);
    const { functionName, args } = decodeFunctionData({ abi: mockSwapperAbi, data: body.transactionRequest.data });
    expect(functionName).toBe("swapAndStartBridgeTokensViaMock");
    expect(args[0]).toMatchObject({ sendingAssetId: zeroAddress, minAmount: amount - lifiFee(amount) });
    const hash = await execute(body, zeroAddress);
    const { body: pending } = await get<{ status: string; transactionId: Hash }>(
      `/v1/status?fromChain=${anvil.id}&txHash=${hash}`,
    );
    expect(pending.status).toBe("PENDING");
    expect(pending.transactionId.slice(0, 42)).toBe(zeroAddress);
  });

  it("swaps before bridging an exact input", async () => {
    const weth = token(anvil.id, "WETH");
    const destination = token(moonbeamDev.id, "USDC");
    const { status, body } = await get<Quote>(
      `/v1/quote?fromChain=${anvil.id}&toChain=${moonbeamDev.id}&fromToken=${weth.address}&toToken=${destination.address}&fromAddress=${account.address}&fromAmount=${parseUnits("0.01", 18)}`,
    );

    expect(status).toBe(200);
    expect(BigInt(body.estimate.toAmount)).toBeGreaterThan(0n);
    expect(decodeFunctionData({ abi: mockSwapperAbi, data: body.transactionRequest.data }).args[0]).toMatchObject({
      sendingAssetId: usdcAddress,
    });
    await execute(body, weth.address);
  });

  it("swaps into the counterpart before bridging", async () => {
    const weth = token(anvil.id, "WETH");
    const destination = token(moonbeamDev.id, "USDC.e");
    const { status, body } = await get<Quote>(
      `/v1/quote?fromChain=${anvil.id}&toChain=${moonbeamDev.id}&fromToken=${weth.address}&toToken=${destination.address}&fromAddress=${account.address}&fromAmount=${parseUnits("0.01", 18)}`,
    );

    expect(status).toBe(200);
    expect(decodeFunctionData({ abi: mockSwapperAbi, data: body.transactionRequest.data }).args[0]).toMatchObject({
      sendingAssetId: usdcAddress,
    });
    await execute(body, weth.address);
  });

  it("swaps before bridging an exact output", async () => {
    const weth = token(anvil.id, "WETH");
    const destination = token(moonbeamDev.id, "USDC");
    const toAmount = parseUnits("5", 6);
    const { status, body } = await get<Quote>(
      `/v1/quote/toAmount?fromChain=${anvil.id}&toChain=${moonbeamDev.id}&fromToken=${weth.address}&toToken=${destination.address}&fromAddress=${account.address}&toAmount=${toAmount}`,
    );

    expect(status).toBe(200);
    expect(body.estimate.toAmount).toBe(String(toAmount));
    await execute(body, weth.address);
  });

  it("returns not found for an unknown token", async () => {
    const usdc = token(anvil.id, "USDC");

    await expect(
      get(
        `/v1/quote?fromChain=${anvil.id}&toChain=${anvil.id}&fromToken=${usdc.address}&toToken=${padHex("0x1", { size: 20 })}&fromAddress=${account.address}&fromAmount=1`,
      ),
    ).resolves.toStrictEqual({ status: 404, body: { code: 1003, message: "token not found" } });
  });

  it("returns not found for an unknown token on exact output", async () => {
    const usdc = token(anvil.id, "USDC");

    await expect(
      get(
        `/v1/quote/toAmount?fromChain=${anvil.id}&toChain=${anvil.id}&fromToken=${padHex("0x1", { size: 20 })}&toToken=${usdc.address}&fromAddress=${account.address}&toAmount=1`,
      ),
    ).resolves.toStrictEqual({ status: 404, body: { code: 1003, message: "token not found" } });
  });

  it("returns no quotes when the output rounds to zero", async () => {
    const usdt = token(anvil.id, "USDT");

    await expect(
      get(
        `/v1/quote?fromChain=${anvil.id}&toChain=${moonbeamDev.id}&fromToken=${usdt.address}&toToken=${zeroAddress}&fromAddress=${account.address}&fromAmount=1`,
      ),
    ).resolves.toStrictEqual({
      status: 404,
      body: { code: 1002, message: "No available quotes for the requested transfer", errors: {} },
    });
  });

  it("returns no quotes when the amount does not cover the fee", async () => {
    const usdc = token(anvil.id, "USDC");

    await expect(
      get(
        `/v1/quote?fromChain=${anvil.id}&toChain=${moonbeamDev.id}&fromToken=${usdc.address}&toToken=${token(moonbeamDev.id, "USDC").address}&fromAddress=${account.address}&fromAmount=100`,
      ),
    ).resolves.toStrictEqual({
      status: 404,
      body: { code: 1002, message: "No available quotes for the requested transfer", errors: {} },
    });
  });

  it("rejects bad amounts", async () => {
    const usdc = token(anvil.id, "USDC");
    const { status, body } = await get(
      `/v1/quote?fromChain=${anvil.id}&toChain=${anvil.id}&fromToken=${usdc.address}&toToken=${usdc.address}&fromAddress=${account.address}&fromAmount=1.5`,
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({ code: "bad mockfi" });
    expectInvalid();
  });

  it("rejects bad slippage", async () => {
    const usdc = token(anvil.id, "USDC");
    const { status } = await quote({
      fromChain: anvil.id,
      toChain: anvil.id,
      fromToken: usdc.address,
      toToken: usdc.address,
      fromAmount: 1,
      slippage: "2",
    });

    expect(status).toBe(400);
    expectInvalid();
  });
});

describe("contract calls", () => {
  const maturity = 4_838_400n;

  function calls(assets: bigint, receiver: Address) {
    return [
      {
        fromAmount: String(assets),
        fromTokenAddress: usdcAddress,
        toContractAddress: marketUSDCAddress,
        toContractGasLimit: "500000",
        toContractCallData: encodeFunctionData({
          abi: marketAbi,
          functionName: "depositAtMaturity",
          args: [maturity, assets, assets, receiver],
        }),
      },
    ];
  }

  it("bridges and calls on the arrival chain", async () => {
    const receiver = fresh();
    const assets = parseUnits("10", 6);
    const { status, body } = await get<Quote>("/v1/quote/contractCalls", {
      fromChain: moonbeamDev.id,
      toChain: anvil.id,
      fromToken: token(moonbeamDev.id, "USDC").address,
      toToken: usdcAddress,
      fromAddress: account.address,
      toAmount: String(assets),
      toFallbackAddress: receiver,
      contractCalls: calls(assets, receiver),
    });

    expect(status).toBe(200);
    expect(body.estimate).toMatchObject({ fromAmount: String(gross(assets)), toAmount: String(assets) });
    const { functionName, args } = decodeFunctionData({ abi: mockSwapperAbi, data: body.transactionRequest.data });
    expect(functionName).toBe("swapAndStartBridgeTokensAndCallViaMock");
    const bridgeData = args[0] as { hasDestinationCall: boolean; receiver: Address };
    const message = args[4] as Hex;
    expect(bridgeData).toMatchObject({ hasDestinationCall: true, receiver });
    const [, swaps, fallback] = decodeAbiParameters(
      [{ type: "bytes32" }, getAbiItem({ abi: mockSwapperAbi, name: "executeViaMock" }).inputs[2], { type: "address" }],
      message,
    );
    expect(fallback).toBe(receiver);
    expect(swaps).toMatchObject([
      { callTo: marketUSDCAddress, approveTo: marketUSDCAddress, fromAmount: assets, requiresDeposit: false },
    ]);
    await execute(body, token(moonbeamDev.id, "USDC").address);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("swaps before bridging and calling", async () => {
    const receiver = fresh();
    const assets = parseUnits("5", 6);
    const { status, body } = await get<Quote>("/v1/quote/contractCalls", {
      fromChain: anvil.id,
      toChain: moonbeamDev.id,
      fromToken: token(anvil.id, "WETH").address,
      toToken: token(moonbeamDev.id, "USDC").address,
      fromAddress: account.address,
      toAmount: String(assets),
      toFallbackAddress: receiver,
      slippage: 0.01,
      contractCalls: calls(assets, receiver),
    });

    expect(status).toBe(200);
    expect(decodeFunctionData({ abi: mockSwapperAbi, data: body.transactionRequest.data }).functionName).toBe(
      "swapAndStartBridgeTokensAndCallViaMock",
    );
    await execute(body, token(anvil.id, "WETH").address);
  });

  it("returns no quotes on the same network or to native ether", async () => {
    const receiver = fresh();
    const request = {
      fromChain: anvil.id,
      fromToken: usdcAddress,
      fromAddress: account.address,
      toAmount: "1",
      contractCalls: calls(1n, receiver),
    };
    const none = {
      status: 404,
      body: { code: 1002, message: "No available quotes for the requested transfer", errors: {} },
    };

    await expect(
      get("/v1/quote/contractCalls", { ...request, toChain: anvil.id, toToken: usdcAddress }),
    ).resolves.toStrictEqual(none);
    await expect(
      get("/v1/quote/contractCalls", { ...request, toChain: moonbeamDev.id, toToken: zeroAddress }),
    ).resolves.toStrictEqual(none);
  });

  it("rejects requests without calls", async () => {
    const { status } = await get("/v1/quote/contractCalls", {
      fromChain: anvil.id,
      toChain: moonbeamDev.id,
      fromToken: usdcAddress,
      toToken: usdcAddress,
      fromAddress: account.address,
      toAmount: "1",
      contractCalls: [],
    });

    expect(status).toBe(400);
    expectInvalid();
  });
});

function expectInvalid() {
  expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("bad mockfi"), {
    fingerprint: ["{{ default }}", "bad mockfi"],
    contexts: { validation: expect.objectContaining({ success: false }) as unknown },
  });
}

describe("status", () => {
  it("returns not found for unknown transactions", async () => {
    await expect(get(`/v1/status?fromChain=${anvil.id}&txHash=${keccak256(toHex("unknown"))}`)).resolves.toStrictEqual({
      status: 200,
      body: { status: "NOT_FOUND" },
    });
  });

  it("returns failed for reverted transactions", async () => {
    const hash = await client(anvil.id).writeContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "transfer",
      args: [zeroAddress, maxUint256],
      gas: 100_000n,
    });
    await expect(client(anvil.id).waitForTransactionReceipt({ hash })).resolves.toMatchObject({ status: "reverted" });

    await expect(get(`/v1/status?fromChain=${anvil.id}&txHash=${hash}`)).resolves.toStrictEqual({
      status: 200,
      body: { status: "FAILED", tool: "mock", sending: { txHash: hash, chainId: anvil.id } },
    });
  });

  it("returns not found for transactions without lifi events", async () => {
    const hash = await client(anvil.id).sendTransaction({ to: account.address, value: 1n });
    await client(anvil.id).waitForTransactionReceipt({ hash });

    await expect(get(`/v1/status?fromChain=${anvil.id}&txHash=${hash}`)).resolves.toStrictEqual({
      status: 200,
      body: { status: "NOT_FOUND" },
    });
  });
});

describe("codegen", () => {
  afterEach(() => {
    vi.doUnmock("@exactly/common/generated/chain");
    vi.resetModules();
  });

  it("lists only market tokens without an allowlist", async () => {
    vi.resetModules();
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => ({
      ...(await importOriginal<typeof Chain>()),
      allowlists: {},
    }));
    const { default: create } = await import("../../hooks/mockfi");
    const response = await create({ database }).app.request(`/v1/tokens?chains=${anvil.id}`);
    const body = (await response.json()) as { tokens: Record<number, Token[]> };

    expect(body.tokens[anvil.id]?.map(({ symbol }) => symbol)).not.toContain("USDT");
    expect(body.tokens[anvil.id]?.map(({ symbol }) => symbol)).toContain("USDC");
  });

  it("leaves out allowlisted tokens without a pool", async () => {
    vi.resetModules();
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => ({
      ...(await importOriginal<typeof Chain>()),
      allowlists: { [anvil.id]: [marketUSDCAddress] },
    }));
    const { default: create } = await import("../../hooks/mockfi");
    const response = await create({ database }).app.request(`/v1/tokens?chains=${anvil.id}`);
    const body = (await response.json()) as { tokens: Record<number, Token[]> };

    expect(body.tokens[anvil.id]?.map(({ address }) => address)).not.toContain(marketUSDCAddress);
    expect(body.tokens[anvil.id]?.map(({ symbol }) => symbol)).toContain("USDC");
  });

  it("leaves out allowlisted tokens with an empty pool", async () => {
    const factory = await client(anvil.id).readContract({
      address: swapperAddress,
      abi: mockSwapperAbi,
      functionName: "VELODROME_FACTORY",
    });
    await client(anvil.id).waitForTransactionReceipt({
      hash: await client(anvil.id).writeContract({
        address: factory,
        abi: parseAbi(["function createPool(address tokenA, address tokenB, bool stable) returns (address)"]),
        functionName: "createPool",
        args: [marketWETHAddress, usdcAddress, false],
      }),
    });
    vi.resetModules();
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => ({
      ...(await importOriginal<typeof Chain>()),
      allowlists: { [anvil.id]: [marketWETHAddress] },
    }));
    const { default: create } = await import("../../hooks/mockfi");
    const response = await create({ database }).app.request(`/v1/tokens?chains=${anvil.id}`);
    const body = (await response.json()) as { tokens: Record<number, Token[]> };

    expect(body.tokens[anvil.id]?.map(({ address }) => address)).not.toContain(marketWETHAddress);
    expect(body.tokens[anvil.id]?.map(({ symbol }) => symbol)).toContain("USDC");

    const pool = await client(anvil.id).readContract({
      address: factory,
      abi: parseAbi(["function getPool(address tokenA, address tokenB, bool stable) view returns (address)"]),
      functionName: "getPool",
      args: [marketWETHAddress, usdcAddress, false],
    });
    const assets = parseUnits("1", 18);
    await client(anvil.id).waitForTransactionReceipt({
      hash: await client(anvil.id).writeContract({
        address: token(anvil.id, "WETH").address,
        abi: mintAbi,
        functionName: "mint",
        args: [account.address, assets],
      }),
    });
    await client(anvil.id).waitForTransactionReceipt({
      hash: await client(anvil.id).writeContract({
        address: token(anvil.id, "WETH").address,
        abi: erc20Abi,
        functionName: "approve",
        args: [marketWETHAddress, assets],
      }),
    });
    await client(anvil.id).waitForTransactionReceipt({
      hash: await client(anvil.id).writeContract({
        address: marketWETHAddress,
        abi: marketAbi,
        functionName: "deposit",
        args: [assets, pool],
      }),
    });
    const funded = await create({ database }).app.request(`/v1/tokens?chains=${anvil.id}`);
    const listed = (await funded.json()) as { tokens: Record<number, Token[]> };

    expect(listed.tokens[anvil.id]?.map(({ address }) => address)).not.toContain(marketWETHAddress);
  });

  it("lists mock swapper testnets and bridges them into exa networks", async () => {
    const foreign = 4242;
    vi.resetModules();
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => {
      const original = await importOriginal<typeof Chain>();
      const anvil2 = original.chains.get(moonbeamDev.id);
      if (!anvil2) throw new Error("missing anvil2");
      return {
        ...original,
        alchemyChains: new Map([
          ...original.alchemyChains,
          [
            foreign,
            {
              id: foreign,
              name: "Foreign",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: anvil2.rpcUrls,
              alchemyNetwork: "FOREIGN",
              testnet: true,
              mockfi: { startBlock: 0 },
              swapper: anvil2.swapper,
            },
          ],
          [
            foreign + 1,
            {
              id: foreign + 1,
              name: "Bare",
              rpcUrls: anvil2.rpcUrls,
              alchemyNetwork: "BARE",
              testnet: true,
              mockfi: { startBlock: 0 },
              swapper: anvil2.swapper,
            },
          ],
          [
            foreign + 2,
            {
              id: foreign + 2,
              name: "Other",
              nativeCurrency: { name: "Other", symbol: "OTH", decimals: 18 },
              rpcUrls: anvil2.rpcUrls,
              alchemyNetwork: "OTHER",
              testnet: true,
              mockfi: { startBlock: 0 },
              swapper: anvil2.swapper,
            },
          ],
        ]),
      };
    });
    const { default: create } = await import("../../hooks/mockfi");
    const mockfi = create({ database }).app;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- response shape per endpoint
    const request = async <T>(path: string) => {
      const response = await mockfi.request(path);
      return { status: response.status, body: (await response.json()) as T };
    };

    const { body: listed } = await request<{
      chains: { diamondAddress: Address; id: number; multicallAddress: string; nativeToken: Token }[];
    }>("/v1/chains");
    expect(listed.chains.find(({ id }) => id === foreign)).toMatchObject({
      diamondAddress: swapperAddress,
      multicallAddress: "",
      nativeToken: { address: zeroAddress, symbol: "ETH", priceUSD: token(anvil.id, "ETH").priceUSD },
    });
    expect(listed.chains.find(({ id }) => id === foreign + 1)).toMatchObject({
      nativeToken: { symbol: "ETH", decimals: 18, priceUSD: token(anvil.id, "ETH").priceUSD },
    });
    expect(listed.chains.find(({ id }) => id === foreign + 2)).toMatchObject({
      nativeToken: { symbol: "OTH", priceUSD: "0" },
    });

    const { body: tools } = await request<{
      bridges: { supportedChains: { fromChainId: number; toChainId: number }[] }[];
      exchanges: { supportedChains: number[] }[];
    }>("/v1/tools");
    expect(tools.bridges[0]?.supportedChains).toContainEqual({ fromChainId: foreign, toChainId: anvil.id });
    expect(tools.bridges[0]?.supportedChains.map(({ toChainId }) => toChainId)).not.toContain(foreign);
    expect(tools.exchanges[0]?.supportedChains).not.toContain(foreign);

    const amount = parseUnits("0.001", 18);
    const params = (fromChain: number, toChain: number) =>
      String(
        new URLSearchParams({
          fromAddress: account.address,
          fromChain: String(fromChain),
          toChain: String(toChain),
          fromToken: zeroAddress,
          toToken: zeroAddress,
          fromAmount: String(amount),
        }),
      );
    const { status, body } = await request<Quote>(`/v1/quote?${params(foreign, anvil.id)}`);
    expect(status).toBe(200);
    expect(body.transactionRequest).toMatchObject({ chainId: foreign, to: swapperAddress, value: toHex(amount) });
    const { functionName, args } = decodeFunctionData({ abi: mockSwapperAbi, data: body.transactionRequest.data });
    expect(functionName).toBe("swapAndStartBridgeTokensViaMock");
    expect(args[0]).toMatchObject({ sendingAssetId: zeroAddress, destinationChainId: BigInt(anvil.id) });

    await expect(request(`/v1/quote?${params(anvil.id, foreign)}`)).resolves.toMatchObject({ status: 400 });
  });

  it("quotes only the bridges the relay delivers", async () => {
    const [left, right] = [4343, 4444];
    vi.resetModules();
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => {
      const original = await importOriginal<typeof Chain>();
      const anvil2 = original.chains.get(moonbeamDev.id);
      if (!anvil2) throw new Error("missing anvil2");
      const peer = (id: number) => [id, { ...anvil2, id, name: `Peer ${id}`, alchemyNetwork: `PEER_${id}` }] as const;
      return {
        ...original,
        alchemyChains: new Map([...original.alchemyChains, peer(left), peer(right)]),
        peers: new Map([peer(left), peer(right)]),
        allowlists: { ...original.allowlists, [left]: [token(moonbeamDev.id, "WETH").address] },
      };
    });
    const { default: create } = await import("../../hooks/mockfi");
    const mockfi = create({ database, testnets: true }).app;
    const status = async (path: string) => {
      const response = await mockfi.request(path);
      return response.status;
    };
    const usdc = token(anvil.id, "USDC");
    const peerUSDC = token(moonbeamDev.id, "USDC");

    const response = await mockfi.request("/v1/tools");
    const { bridges } = (await response.json()) as {
      bridges: { supportedChains: { fromChainId: number; toChainId: number }[] }[];
    };
    expect(bridges[0]?.supportedChains).toContainEqual({ fromChainId: anvil.id, toChainId: left });
    expect(bridges[0]?.supportedChains).not.toContainEqual({ fromChainId: left, toChainId: right });
    await expect(status(`/v1/quote?${relayParameters(left, right, zeroAddress, zeroAddress)}`)).resolves.toBe(404);
    await expect(status(`/v1/quote?${relayParameters(anvil.id, left, usdc.address, peerUSDC.address)}`)).resolves.toBe(
      404,
    );
    await expect(status(`/v1/quote?${relayParameters(anvil.id, right, usdc.address, peerUSDC.address)}`)).resolves.toBe(
      404,
    );
    await expect(status(`/v1/quote?${relayParameters(anvil.id, left, zeroAddress, zeroAddress)}`)).resolves.toBe(200);
  });

  it("refuses to run outside testnets", async () => {
    vi.resetModules();
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => {
      const original = await importOriginal<typeof Chain>();
      return { ...original, default: { ...original.default, testnet: false } };
    });
    const { default: create } = await import("../../hooks/mockfi");

    expect(() => create({ database })).toThrow("mockfi outside testnets");
  });
});

function relayParameters(fromChain: number, toChain: number, fromToken: Address, toToken: Address) {
  return String(
    new URLSearchParams({
      fromAddress: account.address,
      fromChain: String(fromChain),
      toChain: String(toChain),
      fromToken,
      toToken,
      fromAmount: String(parseUnits("10", 6)),
    }),
  );
}
