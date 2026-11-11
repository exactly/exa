import { findWebhook } from "./mocks/alchemy";
import "./mocks/onesignal";
import "./mocks/segment";
import "./mocks/sentry";
import "./mocks/traceClient";
import "./mocks/wallet";

import { captureException } from "@sentry/node";
import { testClient } from "hono/testing";
import { parse } from "valibot";
import {
  createTestClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  hexToBigInt,
  http,
  padHex,
  parseEventLogs,
  parseUnits,
  publicActions,
  walletActions,
  zeroHash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anvil, moonbeamDev } from "viem/chains";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain, {
  auditorAbi,
  depositorAbi,
  depositorAddress,
  exaAccountFactoryAbi,
  exaAccountFactoryAddress,
  exaPluginAbi,
  exaPreviewerAbi,
  firewallAbi,
  marketAbi,
  marketUSDCAddress,
  mockSwapperAbi,
  networks,
  proposalManagerAbi,
  swapperAddress,
  upgradeableModularAccountAbi,
  usdcAddress,
  wethAddress,
} from "@exactly/common/generated/chain";
import ProposalType from "@exactly/common/ProposalType";
import { Address } from "@exactly/common/validation";
import deploy from "@exactly/plugin/deploy.json";

import { chains } from "./anvil";
import anvilClient from "./anvilClient";
import lifi from "./lifi";
import database from "../database";
import createBlockHook from "../hooks/block";
import createAlchemy, { NETWORKS } from "../utils/alchemy";
import createOnesignal from "../utils/onesignal";
import publicClient from "../utils/publicClient";
import redis, { bullmq } from "../utils/redis";
import createSegment from "../utils/segment";
import wallet from "../utils/wallet";
import createPoke from "../workers/poke/queue";
import pokeWorker from "../workers/poke/worker";

const anvil2 = NETWORKS.get("ANVIL2");
if (!anvil2) throw new Error("missing anvil2");
if (!depositorAddress) throw new Error("missing depositor");
const depositor = depositorAddress;
const anvil2Client = createTestClient({ chain: anvil2, mode: "anvil", transport: http() })
  .extend(publicActions)
  .extend(walletActions);
const anvil2Auditor = await anvil2Client.readContract({
  address: parse(Address, networks.get(moonbeamDev.id)?.exaPreviewer),
  functionName: "AUDITOR",
  abi: exaPreviewerAbi,
});
const keeper = wallet(privateKeyToAccount(padHex("0x69")));
const onesignal = createOnesignal("onesignal");
const poke = createPoke(bullmq);
const quotes = lifi(chains);
vi.mocked(findWebhook).mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- create path
const blockHook = createBlockHook({
  alchemy: createAlchemy("webhooks"),
  database,
  executor: privateKeyToAccount(padHex("0x69")),
  onesignal,
  redis,
});
const blockClient = testClient(blockHook.app);
const amount = parseUnits("100", 6);
let worker: Awaited<ReturnType<typeof pokeWorker>>;
let owner: ReturnType<typeof privateKeyToAccount>;
let account: Address;
let maturity: bigint;

beforeAll(async () => {
  worker = pokeWorker({
    bullmq,
    onesignal,
    poker: privateKeyToAccount(padHex("0xb0b")),
    segment: createSegment("segment"),
  });
  await Promise.all([blockHook.ready, worker.ready]);
});

afterAll(async () => {
  await Promise.all([worker.close(), poke.close()]);
});

beforeEach(async () => {
  owner = privateKeyToAccount(generatePrivateKey());
  account = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner.address), y: zeroHash });
  const { timestamp } = await anvil2Client.getBlock();
  maturity = (timestamp / 2_419_200n + 1n) * 2_419_200n;
  await Promise.all([
    anvilClient.setBalance({ address: owner.address, value: 10n ** 18n }),
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
});

describe("fixed deposit on another network", () => {
  it("deposits a protocol asset at maturity through a proposal", async () => {
    await mint(account, amount * 2n);
    await keeper.exaSend(
      { name: "poke", op: "exa.poke" },
      { address: account, abi: exaPluginAbi, functionName: "poke", args: [marketUSDCAddress] },
    );
    const route = await quote(amount);

    const receipt = await anvilClient.waitForTransactionReceipt({
      hash: await execute(
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
              [{ assetOut: wethAddress, minAmountOut: 0n, route }],
            ),
          ],
        }),
      ),
    });
    const [proposed] = parseEventLogs({ abi: proposalManagerAbi, eventName: "Proposed", logs: receipt.logs });
    if (!proposed) throw new Error("missing proposal");
    await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
    vi.setSystemTime(new Date(Number(proposed.args.unlock + 10n) * 1000));
    await blockClient.index.$post({
      header: {},
      json: {
        type: "GRAPHQL",
        event: {
          data: {
            block: {
              number: Number(receipt.blockNumber),
              timestamp: Number(proposed.args.unlock),
              logs: [{ topics: proposed.topics, data: proposed.data, account: { address: proposed.address } }],
            },
          },
        },
      },
    });
    vi.useRealTimers();
    await vi.waitUntil(() => started(account), 26_666);

    await deliver(account);

    await expect(fixedDeposit(account)).resolves.toBe(amount);
    await expect(anvil2Client.getCode({ address: account })).resolves.toBeUndefined();
    await expect(floatingDeposit(account, publicClient)).resolves.toBeLessThanOrEqual(amount);
    expect(captured(account)).toStrictEqual([]);
  });

  it("deposits a wallet asset at maturity in one operation", async () => {
    await mint(account, amount);
    await bridge(await quote(amount));
    await deliver(account);

    await expect(fixedDeposit(account)).resolves.toBe(amount);
    await expect(anvil2Client.getCode({ address: account })).resolves.toBeUndefined();
    expect(captured(account)).toStrictEqual([]);
  });

  it("falls back to a floating deposit when the fixed deposit reverts", async () => {
    await mint(account, amount);
    await bridge(await quote(amount, amount + 1n));
    await deliver(account);
    await poke.enqueue({
      account,
      assets: [parse(Address, usdcAddress)],
      chainId: moonbeamDev.id,
      factory: parse(Address, exaAccountFactoryAddress),
      origin: "activity",
      publicKey: owner.address,
      salt: parse(Address, padHex("0x0", { size: 20 })),
      source: null,
    });

    await vi.waitUntil(async () => (await floatingDeposit(account, anvil2Client)) > 0n, 26_666);
    expect(amount - (await floatingDeposit(account, anvil2Client))).toBeLessThanOrEqual(1n);
    await expect(
      anvil2Client.readContract({ address: usdcAddress, functionName: "balanceOf", args: [account], abi: erc20Abi }),
    ).resolves.toBe(0n);
    await expect(fixedDeposit(account)).resolves.toBe(0n);
    await expect(anvil2Client.getCode({ address: account })).resolves.toBeDefined();
    expect(captured(account)).toStrictEqual([]);
  });
});

async function quote(assets: bigint, minAssets = assets) {
  const response = await quotes.request("/v1/quote/contractCalls", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fromChain: anvil.id,
      toChain: moonbeamDev.id,
      fromToken: usdcAddress,
      toToken: usdcAddress,
      fromAddress: account,
      toAmount: String(assets),
      toFallbackAddress: account,
      contractCalls: [
        {
          fromAmount: String(assets),
          fromTokenAddress: usdcAddress,
          toContractAddress: depositor,
          toContractGasLimit: "500000",
          toContractCallData: encodeFunctionData({
            abi: depositorAbi,
            functionName: "depositAtMaturity",
            args: [marketUSDCAddress, maturity, assets, minAssets, account],
          }),
        },
      ],
    }),
  });
  const { transactionRequest } = (await response.json()) as { transactionRequest: { data: Hex } };
  return transactionRequest.data;
}

async function bridge(route: Hex) {
  await anvilClient.waitForTransactionReceipt({
    hash: await createWalletClient({ chain, transport: http(), account: owner }).writeContract({
      address: account,
      functionName: "executeBatch",
      args: [
        [
          {
            target: usdcAddress,
            value: 0n,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [swapperAddress, amount] }),
          },
          { target: swapperAddress, value: 0n, data: route },
        ],
      ],
      abi: [...upgradeableModularAccountAbi, ...exaPluginAbi, ...marketAbi],
    }),
  });
}

async function started(receiver: Address) {
  const logs = await publicClient.getContractEvents({
    address: swapperAddress,
    abi: mockSwapperAbi,
    eventName: "LiFiTransferStarted",
    fromBlock: 0n,
  });
  return logs.find(({ args }) => args.bridgeData?.receiver === receiver)?.args.bridgeData;
}

async function deliver(receiver: Address) {
  const bridgeData = await started(receiver);
  if (!bridgeData) throw new Error("missing transfer");
  const [sent] = await publicClient.getContractEvents({
    address: swapperAddress,
    abi: mockSwapperAbi,
    eventName: "BridgeMessage",
    args: { transactionId: bridgeData.transactionId },
    fromBlock: 0n,
  });
  if (!sent?.args.message) throw new Error("missing message");
  await anvil2Client.waitForTransactionReceipt({
    hash: await anvil2Client.writeContract({
      account: null,
      address: swapperAddress,
      functionName: "completeBridgeTokensAndCallViaMock",
      args: [bridgeData.transactionId, usdcAddress, bridgeData.minAmount, sent.args.message],
      abi: mockSwapperAbi,
      gas: 1_000_000n,
    }),
  });
}

async function fixedDeposit(address: Address) {
  const [principal] = await anvil2Client.readContract({
    address: marketUSDCAddress,
    functionName: "fixedDepositPositions",
    args: [maturity, address],
    abi: marketAbi,
  });
  return principal;
}

function captured(address: Address) {
  return vi.mocked(captureException).mock.calls.filter(([error]) => String(error).includes(address));
}

async function floatingDeposit(address: Address, client: typeof anvil2Client | typeof publicClient) {
  return client.readContract({
    address: marketUSDCAddress,
    functionName: "convertToAssets",
    args: [
      await client.readContract({
        address: marketUSDCAddress,
        functionName: "balanceOf",
        args: [address],
        abi: marketAbi,
      }),
    ],
    abi: marketAbi,
  });
}

function execute(calldata: Hex) {
  return createWalletClient({ chain, transport: http(), account: owner }).writeContract({
    address: account,
    functionName: "execute",
    args: [account, 0n, calldata],
    abi: [...exaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi],
    gas: 6_666_666n,
  });
}

async function mint(address: Address, value: bigint) {
  await anvilClient.waitForTransactionReceipt({
    hash: await anvilClient.writeContract({
      account: null,
      address: usdcAddress,
      functionName: "mint",
      args: [address, value],
      abi: [
        {
          type: "function",
          name: "mint",
          stateMutability: "nonpayable",
          inputs: [{ type: "address" }, { type: "uint256" }],
          outputs: [],
        },
      ],
    }),
  });
}

async function allow(address: Address) {
  const allower = wallet(privateKeyToAccount(padHex("0x69")), anvil2);
  await allower.waitForTransactionReceipt({
    hash: await allower.writeContract({
      address: await anvil2Client.readContract({ address: anvil2Auditor, functionName: "firewall", abi: auditorAbi }),
      functionName: "allow",
      args: [address, true],
      abi: firewallAbi,
    }),
  });
}
