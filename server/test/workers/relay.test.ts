import "../mocks/sentry";
import "../mocks/wallet";

import { captureException, startSpan } from "@sentry/node";
import { Queue, QueueEvents } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
import { parse } from "valibot";
import {
  concatHex,
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  hexToBigInt,
  http,
  padHex,
  parseAbi,
  parseEventLogs,
  parseUnits,
  publicActions,
  toHex,
  walletActions,
  zeroAddress,
  zeroHash,
  type Hex,
  type Chain as Network,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anvil, moonbeamDev } from "viem/chains";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import {
  auditorAbi,
  auditorAddress,
  depositorAbi,
  depositorAddress,
  exaAccountFactoryAbi,
  exaAccountFactoryAddress,
  exaPluginAbi,
  firewallAbi,
  marketAbi,
  marketUSDCAddress,
  mockSwapperAbi,
  proposalManagerAbi,
  swapperAddress,
  upgradeableModularAccountAbi,
  usdcAddress,
  wethAddress,
} from "@exactly/common/generated/chain";
import ProposalType from "@exactly/common/ProposalType";
import { Address } from "@exactly/common/validation";
import { MATURITY_INTERVAL } from "@exactly/lib";
import deploy from "@exactly/plugin/deploy.json";

import database from "../../database";
import { bridgeCompletions, markets } from "../../database/indexer";
import createMockfi from "../../hooks/mockfi";
import { NETWORKS } from "../../utils/alchemy";
import { bullmq } from "../../utils/redis";
import wallet from "../../utils/wallet";
import { attempts, type Job } from "../../workers/relay/job";
import relayWorker from "../../workers/relay/worker";
import { finished, tip } from "../redis";

import type * as Chain from "@exactly/common/generated/chain";

const mintAbi = parseAbi(["function mint(address to, uint256 value)"]);
const sender = privateKeyToAccount(generatePrivateKey());
const source = testClient({ ...moonbeamDev, name: "Anvil2" });
const target = testClient(anvil);
const queue = new Queue<Job, void, "relay">("relay", { connection: bullmq });
const events = new QueueEvents("relay", { connection: bullmq, lastEventId: await tip(bullmq, queue) });
const [destination] = await database
  .select({ asset: markets.asset })
  .from(markets)
  .where(and(eq(markets.chainId, anvil.id), eq(markets.symbol, "USDC")));
if (!destination) throw new Error("missing anvil usdc market");
const asset = parse(Address, destination.asset);
const { app: mockfi } = createMockfi({ database });
const allower = wallet(sender, NETWORKS.get("ANVIL2"));
const keeper = wallet(privateKeyToAccount(padHex("0x69")));
const poker = wallet(privateKeyToAccount(padHex("0xb0b")), NETWORKS.get("ANVIL2"));
let worker: ReturnType<typeof relayWorker>;

beforeAll(async () => {
  await Promise.all([source, target].map((c) => c.setBalance({ address: sender.address, value: 10n ** 20n })));
  worker = relayWorker({ bridger: sender, bullmq, database });
  await worker.ready;
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

afterAll(async () => {
  await worker.close();
  await Promise.all([events.close(), queue.close()]);
});

async function bridge(
  amount: bigint,
  receiver = parse(Address, privateKeyToAccount(generatePrivateKey()).address),
  delivered: Hex = asset,
) {
  const transactionId = concatHex([delivered.toLowerCase() as Hex, toHex(crypto.getRandomValues(new Uint8Array(12)))]);
  await source.waitForTransactionReceipt({
    hash: await source.writeContract({
      address: usdcAddress,
      abi: mintAbi,
      functionName: "mint",
      args: [sender.address, amount],
    }),
  });
  await source.waitForTransactionReceipt({
    hash: await source.writeContract({
      address: usdcAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [swapperAddress, amount],
    }),
  });
  const hash = await source.writeContract({
    address: swapperAddress,
    abi: mockSwapperAbi,
    functionName: "startBridgeTokensViaMock",
    args: [
      {
        transactionId,
        bridge: "mock",
        integrator: "exa_app",
        referrer: zeroAddress,
        sendingAssetId: usdcAddress,
        receiver,
        minAmount: amount,
        destinationChainId: BigInt(anvil.id),
        hasSourceSwaps: false,
        hasDestinationCall: false,
      },
    ],
  });
  await source.waitForTransactionReceipt({ hash });
  return { receiver, transactionId };
}

type Route = { transactionRequest: { data: Hex; to: Address; value: Hex } };

async function tokens(chainId: number) {
  const response = await mockfi.request(`/v1/tokens?chains=${chainId}`);
  const { tokens: listed } = (await response.json()) as {
    tokens: Record<number, undefined | { address: string; symbol: string }[]>;
  };
  return listed[chainId] ?? [];
}

async function quote(path: string, init?: RequestInit) {
  const response = await mockfi.request(path, init);
  expect(response.status).toBe(200);
  return (await response.json()) as Route;
}

async function deposit(receiver: Address, maturity: bigint, assets: bigint, call: { data: Hex; to: Address }) {
  return quote("/v1/quote/contractCalls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fromChain: anvil.id,
      toChain: moonbeamDev.id,
      fromToken: usdcAddress,
      toToken: usdcAddress,
      fromAddress: sender.address,
      toAmount: String(assets),
      toFallbackAddress: receiver,
      integrator: "exa_app",
      contractCalls: [
        {
          fromAmount: String(assets),
          fromTokenAddress: usdcAddress,
          toContractAddress: call.to,
          toContractGasLimit: "500000",
          toContractCallData: call.data,
        },
      ],
    }),
  });
}

async function send({ transactionRequest: { data, to, value } }: Route, approve?: bigint, from = source) {
  if (approve) {
    await from.waitForTransactionReceipt({
      hash: await from.writeContract({
        address: usdcAddress,
        abi: mintAbi,
        functionName: "mint",
        args: [sender.address, approve],
      }),
    });
    await from.waitForTransactionReceipt({
      hash: await from.writeContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [to, approve],
      }),
    });
  }
  const hash = await from.sendTransaction({ to, data, value: BigInt(value) });
  await expect(from.waitForTransactionReceipt({ hash })).resolves.toMatchObject({ status: "success" });
  return hash;
}

async function status(hash: Hex, expected: "DONE" | RegExp, fromChain: number = moonbeamDev.id) {
  const response = await mockfi.request(`/v1/status?fromChain=${fromChain}&txHash=${hash}`);
  const body = (await response.json()) as { receiving?: unknown; status: string; transactionId: Hex };
  expect(body.status).toMatch(expected);
  return body;
}

async function nextMaturity() {
  const { timestamp } = await source.getBlock();
  return timestamp - (timestamp % BigInt(MATURITY_INTERVAL)) + BigInt(MATURITY_INTERVAL);
}

function completion(transactionId: Hex, chainId: number = anvil.id) {
  return vi.waitUntil(
    () =>
      database
        .select()
        .from(bridgeCompletions)
        .where(and(eq(bridgeCompletions.chainId, chainId), eq(bridgeCompletions.transactionId, transactionId)))
        .then(([row]) => row),
    { timeout: 30_000, interval: 200 },
  );
}

function testClient(chain: Network) {
  return createTestClient({ account: sender, chain, mode: "anvil", transport: http() })
    .extend(publicActions)
    .extend(walletActions);
}

function arrived(address: `0x${string}`) {
  return source.readContract({ address: usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

async function allowed() {
  const receiver = parse(Address, privateKeyToAccount(generatePrivateKey()).address);
  await allow(receiver);
  return receiver;
}

async function allow(receiver: Address) {
  await allower.waitForTransactionReceipt({
    hash: await allower.writeContract({
      address: await source.readContract({ address: auditorAddress, abi: auditorAbi, functionName: "firewall" }),
      abi: firewallAbi,
      functionName: "allow",
      args: [receiver, true],
    }),
  });
}

function balance(address: `0x${string}`) {
  return target.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

describe("relay", () => {
  it("completes a bridge on the destination as soon as it is indexed", async () => {
    await target.waitForTransactionReceipt({
      hash: await target.writeContract({
        address: asset,
        abi: mintAbi,
        functionName: "mint",
        args: [swapperAddress, 10n ** 12n],
      }),
    });
    const { receiver, transactionId } = await bridge(1_000_000n);

    await expect(completion(transactionId)).resolves.toMatchObject({
      receiver: receiver.toLowerCase(),
      amount: 1_000_000n,
    });
    await expect(balance(receiver)).resolves.toBe(1_000_000n);
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "complete bridge",
        op: "exa.bridge",
        attributes: { account: receiver, transactionId },
      }),
      expect.any(Function),
    );
    expect(startSpan).not.toHaveBeenCalledWith(
      expect.objectContaining({ op: "exa.mint", attributes: { asset, transactionId } }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("mints the shortfall when the swapper lacks liquidity", async () => {
    const amount = (await balance(swapperAddress)) + parseUnits("1000000", 6);
    const { receiver, transactionId } = await bridge(amount);

    await expect(completion(transactionId)).resolves.toMatchObject({ amount });
    await expect(balance(receiver)).resolves.toBe(amount);
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "mint bridged asset", op: "exa.mint", attributes: { asset, transactionId } }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips bridges already completed", async () => {
    const { receiver, transactionId } = await bridge(1n);
    const { hash } = await completion(transactionId);
    const result = finished(events, "again");

    await queue.add(
      "relay",
      {
        amount: "1",
        asset,
        chainId: anvil.id,
        receiver,
        source: { chainId: moonbeamDev.id, hash: zeroHash },
        transactionId,
      },
      { jobId: "again", attempts, removeOnComplete: true, removeOnFail: true },
    );

    await expect(result).resolves.toBeUndefined();
    await expect(completion(transactionId)).resolves.toMatchObject({ hash });
  });

  it("delivers allowlisted tokens", async () => {
    const listed = await tokens(anvil.id);
    const usdt = parse(Address, listed.find(({ symbol }) => symbol === "USDT")?.address);
    const { receiver, transactionId } = await bridge(1_000_000n, undefined, usdt);

    await expect(completion(transactionId)).resolves.toMatchObject({ asset: usdt.toLowerCase() });
    await expect(
      target.readContract({ address: usdt, abi: erc20Abi, functionName: "balanceOf", args: [receiver] }),
    ).resolves.toBe(1_000_000n);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("ignores bridges to unknown assets", async () => {
    const unknown = await bridge(1n, undefined, padHex("0x1", { size: 20 }));
    const known = await bridge(1n);

    await completion(known.transactionId);
    await expect(
      database.select().from(bridgeCompletions).where(eq(bridgeCompletions.transactionId, unknown.transactionId)),
    ).resolves.toStrictEqual([]);
    expect(startSpan).not.toHaveBeenCalledWith(
      expect.objectContaining({
        attributes: expect.objectContaining({ transactionId: unknown.transactionId }) as unknown,
      }),
      expect.any(Function),
    );
  });

  it("delivers native ether quoted by mockfi", async () => {
    const receiver = parse(Address, privateKeyToAccount(generatePrivateKey()).address);
    const amount = parseUnits("0.001", 18);
    const hash = await send(
      await quote(
        `/v1/quote?fromChain=${moonbeamDev.id}&toChain=${anvil.id}&fromToken=${zeroAddress}&toToken=${zeroAddress}&fromAddress=${sender.address}&toAddress=${receiver}&fromAmount=${amount}&integrator=exa_app`,
      ),
    );
    const { transactionId } = await status(hash, /^(PENDING|DONE)$/);

    const { hash: delivered } = await completion(transactionId);
    await expect(target.getBalance({ address: receiver })).resolves.toBe(amount);
    await expect(status(hash, "DONE")).resolves.toMatchObject({ receiving: { txHash: delivered, chainId: anvil.id } });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("deposits at maturity on a verified arrival chain through the depositor", async () => {
    const receiver = await allowed();
    const maturity = await nextMaturity();
    const hash = await send(
      await deposit(receiver, maturity, 1_000_000n, {
        to: parse(Address, depositorAddress),
        data: encodeFunctionData({
          abi: depositorAbi,
          functionName: "depositAtMaturity",
          args: [marketUSDCAddress, maturity, 1_000_000n, 1_000_000n, receiver],
        }),
      }),
      1_000_000n,
      target,
    );
    const { transactionId } = await status(hash, /^(PENDING|DONE)$/, anvil.id);

    await expect(completion(transactionId, moonbeamDev.id)).resolves.toMatchObject({
      receiver: receiver.toLowerCase(),
    });
    await expect(
      source.readContract({
        address: marketUSDCAddress,
        abi: marketAbi,
        functionName: "fixedDepositPositions",
        args: [maturity, receiver],
      }),
    ).resolves.toMatchObject([1_000_000n, expect.any(BigInt)]);
    await expect(arrived(receiver)).resolves.toBe(0n);
    await expect(status(hash, "DONE", anvil.id)).resolves.toMatchObject({ receiving: { chainId: moonbeamDev.id } });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("delivers the tokens when the firewall rejects a direct deposit", async () => {
    const receiver = await allowed();
    const maturity = await nextMaturity();
    const hash = await send(
      await deposit(receiver, maturity, 1_000_000n, {
        to: parse(Address, marketUSDCAddress),
        data: encodeFunctionData({
          abi: marketAbi,
          functionName: "depositAtMaturity",
          args: [maturity, 1_000_000n, 1_000_000n, receiver],
        }),
      }),
      1_000_000n,
      target,
    );
    const { transactionId } = await status(hash, /^(PENDING|DONE)$/, anvil.id);

    await expect(completion(transactionId, moonbeamDev.id)).resolves.toMatchObject({ amount: 1_000_000n });
    await expect(arrived(receiver)).resolves.toBe(1_000_000n);
    await expect(
      source.readContract({
        address: marketUSDCAddress,
        abi: marketAbi,
        functionName: "fixedDepositPositions",
        args: [maturity, receiver],
      }),
    ).resolves.toStrictEqual([0n, 0n]);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures jobs for unsupported chains", async () => {
    const result = finished(events, "unsupported");

    await queue.add(
      "relay",
      {
        amount: "1",
        asset,
        chainId: 10,
        receiver: parse(Address, sender.address),
        source: { chainId: moonbeamDev.id, hash: zeroHash },
        transactionId: concatHex([asset, toHex(0n, { size: 12 })]),
      },
      { jobId: "unsupported", attempts, removeOnComplete: true, removeOnFail: true },
    );

    await expect(result).rejects.toThrow("unsupported chain 10");
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "unsupported chain 10" }),
      {
        level: "error",
        fingerprint: ["{{ default }}", "unknown"],
        tags: { queue: "relay" },
        extra: { attempts: 1, id: "unsupported" },
      },
    );
  });

  it("captures jobs from unsupported chains", async () => {
    const result = finished(events, "unsupported source");

    await queue.add(
      "relay",
      {
        amount: "1",
        asset,
        chainId: anvil.id,
        receiver: parse(Address, sender.address),
        source: { chainId: 10, hash: zeroHash },
        transactionId: concatHex([asset, toHex(1n, { size: 12 })]),
      },
      { jobId: "unsupported source", attempts, removeOnComplete: true, removeOnFail: true },
    );

    await expect(result).rejects.toThrow("unsupported chain 10");
  });

  it("captures scan failures", async () => {
    const error = new Error("scan failed");
    vi.spyOn(database, "select").mockImplementationOnce(() => {
      throw error;
    });

    await database.execute(sql`NOTIFY "indexer_live_query"`);

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.some(([reported]) => reported === error));
    expect(captureException).toHaveBeenCalledWith(error, { level: "error", tags: { queue: "relay" } });
  });

  it("refuses to run outside testnets", async () => {
    vi.resetModules();
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => {
      const original = await importOriginal<typeof Chain>();
      return { ...original, default: { ...original.default, testnet: false } };
    });
    const { default: create } = await import("../../workers/relay/worker");

    expect(() => create({ bridger: sender, bullmq, database })).toThrow("relay outside testnets");
    vi.doUnmock("@exactly/common/generated/chain");
    vi.resetModules();
  });
});

describe("fixed deposits on another network", () => {
  const amount = parseUnits("100", 6);

  it("deposits a protocol asset at maturity through a proposal", async () => {
    const { owner, account, maturity } = await exa();
    await mint(account, amount * 2n);
    await keeper.exaSend(
      { name: "poke", op: "exa.poke" },
      { address: account, abi: exaPluginAbi, functionName: "poke", args: [marketUSDCAddress] },
    );
    const { transactionRequest } = await deposit(account, maturity, amount, {
      to: parse(Address, depositorAddress),
      data: encodeFunctionData({
        abi: depositorAbi,
        functionName: "depositAtMaturity",
        args: [marketUSDCAddress, maturity, amount, amount, account],
      }),
    });

    const receipt = await target.waitForTransactionReceipt({
      hash: await createWalletClient({ chain: anvil, transport: http(), account: owner }).writeContract({
        address: account,
        functionName: "execute",
        args: [
          account,
          0n,
          encodeFunctionData({
            abi: exaPluginAbi,
            functionName: "propose",
            args: [
              marketUSDCAddress,
              amount,
              ProposalType.Swap,
              encodeAbiParameters(
                [
                  {
                    type: "tuple",
                    components: [
                      { name: "assetOut", type: "address" },
                      { name: "minAmountOut", type: "uint256" },
                      { name: "route", type: "bytes" },
                    ],
                  },
                ],
                [{ assetOut: wethAddress, minAmountOut: 0n, route: transactionRequest.data }],
              ),
            ],
          }),
        ],
        abi: [...exaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi],
        gas: 6_666_666n,
      }),
    });
    const [proposed] = parseEventLogs({ abi: proposalManagerAbi, eventName: "Proposed", logs: receipt.logs });
    if (!proposed) throw new Error("missing proposal");
    await target.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
    await keeper.exaSend(
      { name: "exa.execute", op: "exa.execute" },
      {
        address: account,
        functionName: "executeProposal",
        args: [proposed.args.nonce],
        abi: [...exaPluginAbi, ...upgradeableModularAccountAbi, ...proposalManagerAbi, ...auditorAbi, ...marketAbi],
      },
    );
    const transactionId = await vi.waitUntil(() => started(account), { timeout: 30_000, interval: 200 });

    await completion(transactionId, moonbeamDev.id);
    await expect(principal(account, maturity)).resolves.toBe(amount);
    await expect(source.getCode({ address: account })).resolves.toBeUndefined();
    await expect(floating(target, account)).resolves.toBeLessThanOrEqual(amount);
    expect(captured(account)).toStrictEqual([]);
  });

  it("falls back to a floating deposit when the fixed deposit reverts", async () => {
    const { owner, account, maturity } = await exa();
    await mint(account, amount);
    const { transactionRequest } = await deposit(account, maturity, amount, {
      to: parse(Address, depositorAddress),
      data: encodeFunctionData({
        abi: depositorAbi,
        functionName: "depositAtMaturity",
        args: [marketUSDCAddress, maturity, amount, amount + 1n, account],
      }),
    });
    await target.waitForTransactionReceipt({
      hash: await createWalletClient({ chain: anvil, transport: http(), account: owner }).writeContract({
        address: account,
        functionName: "executeBatch",
        args: [
          [
            {
              target: usdcAddress,
              value: 0n,
              data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [swapperAddress, amount] }),
            },
            { target: swapperAddress, value: 0n, data: transactionRequest.data },
          ],
        ],
        abi: [...upgradeableModularAccountAbi, ...exaPluginAbi, ...marketAbi],
      }),
    });
    const transactionId = await vi.waitUntil(() => started(account), { timeout: 30_000, interval: 200 });
    await completion(transactionId, moonbeamDev.id);
    await poker.exaSend(
      { name: "create account", op: "exa.account" },
      {
        address: exaAccountFactoryAddress,
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(owner.address), y: 0n }]],
      },
      { fees: "auto" },
    );
    await poker.exaSend(
      { name: "poke account", op: "exa.poke" },
      { address: account, abi: exaPluginAbi, functionName: "poke", args: [marketUSDCAddress] },
      { fees: "auto" },
    );

    await vi.waitUntil(async () => (await floating(source, account)) > 0n, { timeout: 30_000, interval: 200 });
    expect(amount - (await floating(source, account))).toBeLessThanOrEqual(1n);
    await expect(arrived(account)).resolves.toBe(0n);
    await expect(principal(account, maturity)).resolves.toBe(0n);
    await expect(source.getCode({ address: account })).resolves.toBeDefined();
    expect(captured(account)).toStrictEqual([]);
  });
});

async function exa() {
  const owner = privateKeyToAccount(generatePrivateKey());
  const account = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner.address), y: zeroHash });
  await Promise.all([
    target.setBalance({ address: owner.address, value: 10n ** 18n }),
    keeper.exaSend(
      { name: "create account", op: "exa.account" },
      {
        address: exaAccountFactoryAddress,
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(owner.address), y: 0n }]],
      },
    ),
    allow(account),
  ]);
  return { owner, account, maturity: await nextMaturity() };
}

async function mint(address: Address, value: bigint) {
  await target.waitForTransactionReceipt({
    hash: await target.writeContract({
      address: usdcAddress,
      abi: mintAbi,
      functionName: "mint",
      args: [address, value],
    }),
  });
}

async function started(receiver: Address) {
  const logs = await target.getContractEvents({
    address: swapperAddress,
    abi: mockSwapperAbi,
    eventName: "LiFiTransferStarted",
    fromBlock: 0n,
  });
  return logs.find(({ args }) => args.bridgeData?.receiver === receiver)?.args.bridgeData?.transactionId;
}

async function principal(address: Address, maturity: bigint) {
  const [assets] = await source.readContract({
    address: marketUSDCAddress,
    abi: marketAbi,
    functionName: "fixedDepositPositions",
    args: [maturity, address],
  });
  return assets;
}

async function floating(client: typeof source, address: Address) {
  return client.readContract({
    address: marketUSDCAddress,
    abi: marketAbi,
    functionName: "convertToAssets",
    args: [
      await client.readContract({
        address: marketUSDCAddress,
        abi: marketAbi,
        functionName: "balanceOf",
        args: [address],
      }),
    ],
  });
}

function captured(address: Address) {
  return vi.mocked(captureException).mock.calls.filter(([error]) => String(error).includes(address));
}
