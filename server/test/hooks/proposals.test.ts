import { headerValidator } from "../mocks/alchemy";
import "../mocks/onesignal";
import "../mocks/sentry";
import "../mocks/wallet";

import { captureException } from "@sentry/node";
import { deserialize, serialize } from "@wagmi/core";
import { and, eq, sql } from "drizzle-orm";
import { parse } from "valibot";
import {
  concatHex,
  createTestClient,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  hexToBigInt,
  hexToBytes,
  http,
  padHex,
  parseAbi,
  parseEventLogs,
  publicActions,
  toHex,
  walletActions,
  zeroHash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { moonbeamDev } from "viem/chains";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import {
  activityChains,
  auditorAbi,
  chains,
  exaAccountFactoryAbi,
  exaAccountFactoryAddress,
  exaPluginAbi,
  exaPluginAddress,
  exaPreviewerAbi,
  firewallAbi,
  marketAbi,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import ProposalType from "@exactly/common/ProposalType";
import { Address } from "@exactly/common/validation";

import database, { credentials } from "../../database";
import { markets } from "../../database/indexer";
import createBlockHook from "../../hooks/block";
import createAlchemy from "../../utils/alchemy";
import ensClient from "../../utils/ensClient";
import createOnesignal from "../../utils/onesignal";
import createPersona from "../../utils/persona";
import publicClient from "../../utils/publicClient";
import createManteca from "../../utils/ramps/manteca";
import redis from "../../utils/redis";
import wallet from "../../utils/wallet";

const anvil2 = activityChains.get(moonbeamDev.id);
if (!anvil2?.smartAccount) throw new Error("missing anvil2");
const owner = privateKeyToAccount(generatePrivateKey());
const target = createTestClient({ account: owner, chain: anvil2, mode: "anvil", transport: http() })
  .extend(publicActions)
  .extend(walletActions);
const keeper = wallet(owner, anvil2);
const account = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner.address), y: zeroHash });
const [usdc] = await database
  .select({ address: markets.address, asset: markets.asset })
  .from(markets)
  .where(and(eq(markets.chainId, anvil2.id), eq(markets.symbol, "USDC")));
if (!usdc) throw new Error("missing anvil2 usdc market");
const market = parse(Address, usdc.address);
const asset = parse(Address, usdc.asset);
const manteca = createManteca("manteca", "https://manteca.test");
const persona = createPersona("persona", "https://persona.test");
const hook = createBlockHook({
  alchemy: createAlchemy("webhooks"),
  database,
  executor: owner,
  manteca,
  onesignal: createOnesignal("onesignal"),
  persona,
  redis,
  source: "indexer",
});

beforeAll(async () => {
  await target.setBalance({ address: owner.address, value: 10n ** 20n });
  await target.waitForTransactionReceipt({
    hash: await target.writeContract({
      address: exaAccountFactoryAddress,
      abi: exaAccountFactoryAbi,
      functionName: "createAccount",
      args: [0n, [{ x: hexToBigInt(owner.address), y: 0n }]],
    }),
  });
  await hook.ready;
});

afterEach(() => vi.useRealTimers());

afterAll(() => hook.close());

function queued() {
  return redis
    .zrange("proposals", 0, -1)
    .then((messages) =>
      messages
        .map((message) =>
          deserialize<{ account: string; chainId?: number; nonce: bigint; retryCount?: number }>(message),
        )
        .filter((proposal) => proposal.account === account),
    );
}

describe("indexer source", () => {
  it("executes proposals on their network", async () => {
    vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
    const amount = 1_000_000n;
    const receiver = privateKeyToAccount(generatePrivateKey()).address;
    const auditor = await target.readContract({
      address: parse(Address, chains.get(anvil2.id)?.exaPreviewer),
      abi: exaPreviewerAbi,
      functionName: "AUDITOR",
    });
    await keeper.waitForTransactionReceipt({
      hash: await keeper.writeContract({
        address: await target.readContract({ address: auditor, abi: auditorAbi, functionName: "firewall" }),
        abi: firewallAbi,
        functionName: "allow",
        args: [account, true],
      }),
    });
    await target.waitForTransactionReceipt({
      hash: await target.writeContract({
        address: asset,
        abi: parseAbi(["function mint(address to, uint256 value)"]),
        functionName: "mint",
        args: [account, amount],
      }),
    });
    await keeper.waitForTransactionReceipt({
      hash: await keeper.writeContract({ address: account, abi: exaPluginAbi, functionName: "poke", args: [market] }),
    });
    const held = await target.readContract({
      address: market,
      abi: marketAbi,
      functionName: "maxWithdraw",
      args: [account],
    });
    const { timestamp } = await target.getBlock();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Number(timestamp - 666n) * 1000);

    const advanced = Promise.withResolvers<boolean>();
    const get = redis.get.bind(redis);
    const cursor = vi.spyOn(redis, "get").mockImplementation((async (key: string) => {
      if (key === `cursor:proposals:${anvil2.id}`) await advanced.promise;
      return get(key);
    }) as typeof redis.get);
    await target.setAutomine(false); // cspell:ignore automine
    const hash = await target.writeContract({
      address: account,
      abi: [...exaPluginAbi, ...upgradeableModularAccountAbi],
      functionName: "execute",
      args: [
        account,
        0n,
        encodeFunctionData({
          abi: exaPluginAbi,
          functionName: "propose",
          args: [market, held, ProposalType.Withdraw, encodeAbiParameters([{ type: "address" }], [receiver])],
        }),
      ],
      gas: 6_666_666n,
    });
    await target.mine({ blocks: 1 });
    await target.mine({ blocks: 1, interval: 666 });
    advanced.resolve(true);
    cursor.mockRestore();
    await target.setAutomine(true);
    const receipt = await target.waitForTransactionReceipt({ hash });
    expect(receipt).toMatchObject({ status: "success" });
    const [proposed] = parseEventLogs({ abi: proposalManagerAbi, eventName: "Proposed", logs: receipt.logs });
    if (!proposed) throw new Error("missing proposal");

    await vi.waitUntil(
      async () =>
        (await target.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [receiver] })) ===
        held,
      { timeout: 30_000, interval: 200 },
    );
    await expect(
      target.readContract({
        address: proposed.address,
        abi: proposalManagerAbi,
        functionName: "nonces",
        args: [account],
      }),
    ).resolves.toBeGreaterThan(proposed.args.nonce);
    await vi.waitUntil(() => queued().then((proposals) => proposals.length === 0), { timeout: 30_000, interval: 200 });
    expect(captured(account)).toStrictEqual([]);
  });

  it("withdraws weth as ether on their network", async () => {
    const [weth] = await database
      .select({ address: markets.address })
      .from(markets)
      .where(and(eq(markets.chainId, anvil2.id), eq(markets.symbol, "WETH")));
    const wethMarket = parse(Address, weth?.address);
    const amount = 10n ** 15n;
    const receiver = privateKeyToAccount(generatePrivateKey()).address;
    await target.waitForTransactionReceipt({ hash: await target.sendTransaction({ to: account, value: amount }) });
    await keeper.waitForTransactionReceipt({
      hash: await keeper.writeContract({ address: account, abi: exaPluginAbi, functionName: "pokeETH" }),
    });
    const receipt = await target.waitForTransactionReceipt({
      hash: await target.writeContract({
        address: account,
        abi: [...exaPluginAbi, ...upgradeableModularAccountAbi],
        functionName: "execute",
        args: [
          account,
          0n,
          encodeFunctionData({
            abi: exaPluginAbi,
            functionName: "propose",
            args: [wethMarket, amount, ProposalType.Withdraw, encodeAbiParameters([{ type: "address" }], [receiver])],
          }),
        ],
        gas: 6_666_666n,
      }),
    });
    const [proposed] = parseEventLogs({ abi: proposalManagerAbi, eventName: "Proposed", logs: receipt.logs });
    if (!proposed) throw new Error("missing proposal");
    const { timestamp } = await target.getBlock({ blockNumber: receipt.blockNumber });
    await target.mine({ blocks: 1, interval: Number(proposed.args.unlock - timestamp) });

    await vi.waitUntil(async () => (await target.getBalance({ address: receiver })) === amount, {
      timeout: 30_000,
      interval: 200,
    });
    await vi.waitFor(
      async () => {
        await expect(
          target.readContract({
            address: proposed.address,
            abi: proposalManagerAbi,
            functionName: "nonces",
            args: [account],
          }),
        ).resolves.toBe(proposed.args.nonce + 1n);
      },
      { timeout: 30_000, interval: 200 },
    );
  });

  it("keeps the network of rescheduled proposals", async () => {
    const receiver = privateKeyToAccount(generatePrivateKey()).address;
    const data = encodeAbiParameters([{ type: "address" }], [receiver]);
    const hash = await target.writeContract({
      address: account,
      abi: [...exaPluginAbi, ...upgradeableModularAccountAbi],
      functionName: "execute",
      args: [
        account,
        0n,
        encodeFunctionData({
          abi: exaPluginAbi,
          functionName: "propose",
          args: [market, 1n, ProposalType.Withdraw, data],
        }),
      ],
      gas: 6_666_666n,
    });
    const receipt = await target.waitForTransactionReceipt({ hash });
    const [proposed] = parseEventLogs({ abi: proposalManagerAbi, eventName: "Proposed", logs: receipt.logs });
    if (!proposed) throw new Error("missing proposal");
    const { nonce } = proposed.args;
    const message = serialize({
      account,
      amount: 1n,
      chainId: anvil2.id,
      data,
      market,
      nonce: nonce + 1n,
      proposalType: ProposalType.Withdraw,
      timestamp: 0,
      unlock: 0n,
    });
    const zadd = vi.spyOn(redis, "zadd");
    await redis.zadd("proposals", 0, message);
    const other = createBlockHook({
      alchemy: createAlchemy("webhooks"),
      database,
      executor: owner,
      manteca,
      onesignal: createOnesignal("onesignal"),
      persona,
      redis,
      source: "indexer",
    });
    await other.ready;

    try {
      await vi.waitFor(
        () => {
          expect(
            zadd.mock.calls
              .map((call) => call.slice(0, 3))
              .filter(
                (call): call is [string, number, string] =>
                  call[0] === "proposals" && typeof call[2] === "string" && call[2] !== message,
              )
              .map((call) =>
                deserialize<{ account: string; chainId: number; nonce: bigint; retryCount?: number }>(call[2]),
              ),
          ).toContainEqual(expect.objectContaining({ account, chainId: anvil2.id, nonce, retryCount: 1 }));
        },
        { timeout: 30_000, interval: 200 },
      );
      const { timestamp } = await target.getBlock({ blockNumber: receipt.blockNumber });
      await target.mine({ blocks: 1, interval: Number(proposed.args.unlock - timestamp) });
      await vi.waitUntil(
        async () =>
          (await target.readContract({
            address: proposed.address,
            abi: proposalManagerAbi,
            functionName: "nonces",
            args: [account],
          })) > nonce,
        { timeout: 30_000, interval: 200 },
      );
    } finally {
      await other.close();
    }
    for (const member of await redis.zrange("proposals", 0, -1)) {
      if (deserialize<{ account: string }>(member).account === account) await redis.zrem("proposals", member);
    }
  });

  it("recovers pending proposals on the first sync", async () => {
    const receiver = privateKeyToAccount(generatePrivateKey()).address;
    await target.waitForTransactionReceipt({
      hash: await target.writeContract({
        address: asset,
        abi: parseAbi(["function mint(address to, uint256 value)"]),
        functionName: "mint",
        args: [account, 1000n],
      }),
    });
    await keeper.waitForTransactionReceipt({
      hash: await keeper.writeContract({ address: account, abi: exaPluginAbi, functionName: "poke", args: [market] }),
    });
    const get = redis.get.bind(redis);
    const cursor = vi
      .spyOn(redis, "get")
      .mockImplementation((async (key: string) =>
        key === `cursor:proposals:${anvil2.id}` ? null : get(key)) as typeof redis.get);
    try {
      const receipt = await target.waitForTransactionReceipt({
        hash: await target.writeContract({
          address: account,
          abi: [...exaPluginAbi, ...upgradeableModularAccountAbi],
          functionName: "execute",
          args: [
            account,
            0n,
            encodeFunctionData({
              abi: exaPluginAbi,
              functionName: "propose",
              args: [market, 1n, ProposalType.Withdraw, encodeAbiParameters([{ type: "address" }], [receiver])],
            }),
          ],
          gas: 6_666_666n,
        }),
      });
      const [proposed] = parseEventLogs({ abi: proposalManagerAbi, eventName: "Proposed", logs: receipt.logs });
      if (!proposed) throw new Error("missing proposal");
      const { timestamp } = await target.getBlock({ blockNumber: receipt.blockNumber });
      await target.mine({ blocks: 1, interval: Number(proposed.args.unlock - timestamp) });

      await vi.waitUntil(
        async () =>
          (await target.readContract({
            address: asset,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [receiver],
          })) === 1n,
        { timeout: 30_000, interval: 200 },
      );
      await expect(
        target.readContract({
          address: proposed.address,
          abi: proposalManagerAbi,
          functionName: "nonces",
          args: [account],
        }),
      ).resolves.toBeGreaterThan(proposed.args.nonce);
    } finally {
      cursor.mockRestore();
    }
    expect(await redis.get(`cursor:proposals:${anvil2.id}`)).not.toBeNull();
  });

  it("ignores proposals from foreign emitters", async () => {
    const emitter = privateKeyToAccount(generatePrivateKey()).address;
    const topics = encodeEventTopics({
      abi: proposalManagerAbi,
      eventName: "Proposed",
      args: { account, nonce: 666n, market },
    }) as Hex[];
    await target.setCode({ address: emitter, bytecode: logger(topics.length) });
    const position = await redis.get(`cursor:proposals:${anvil2.id}`);
    const hash = await target.sendTransaction({
      to: emitter,
      data: concatHex([
        ...topics.map((topic) => padHex(topic)),
        encodeAbiParameters(
          [{ type: "uint8" }, { type: "uint256" }, { type: "bytes" }, { type: "uint256" }],
          [ProposalType.None, 1n, "0x", 1n],
        ),
      ]),
    });
    await target.waitForTransactionReceipt({ hash });

    await vi.waitUntil(async () => (await redis.get(`cursor:proposals:${anvil2.id}`)) !== position, {
      timeout: 30_000,
      interval: 200,
    });
    expect(await queued()).not.toContainEqual(expect.objectContaining({ nonce: 666n }));
  });

  it.each(["indexer", "alchemy"] as const)("keeps the alchemy signing key on the %s source", async (source) => {
    const other = createBlockHook({
      alchemy: createAlchemy("webhooks"),
      blockKey: "block",
      database,
      executor: owner,
      manteca,
      onesignal: createOnesignal("onesignal"),
      persona,
      redis,
      source,
    });
    await other.ready;

    expect(vi.mocked(headerValidator).mock.lastCall?.[0].has("block")).toBe(true);
    await expect(other.close()).resolves.toBeUndefined();
  });

  it("handles webhook proposals alongside the indexer", async () => {
    await database
      .insert(credentials)
      .values({
        id: "webhook-proposals",
        publicKey: new Uint8Array(hexToBytes(owner.address)),
        account,
        factory: exaAccountFactoryAddress,
      })
      .onConflictDoNothing();
    const readContract = vi.spyOn(publicClient, "readContract");
    const nonce = 777n;

    const response = await hook.app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "GRAPHQL",
        event: {
          data: {
            block: {
              number: 1,
              timestamp: 0,
              logs: [
                {
                  topics: encodeEventTopics({
                    abi: proposalManagerAbi,
                    eventName: "Proposed",
                    args: { account, nonce, market },
                  }),
                  data: encodeAbiParameters(
                    [{ type: "uint8" }, { type: "uint256" }, { type: "bytes" }, { type: "uint256" }],
                    [ProposalType.None, 1n, "0x", 1n],
                  ),
                  account: { address: exaPluginAddress },
                },
              ],
            },
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "proposalManager" }));
    readContract.mockRestore();
  });

  it("captures sync failures", async () => {
    const error = new Error("sync failed");
    vi.spyOn(redis, "get").mockRejectedValueOnce(error);

    await database.execute(sql`NOTIFY "indexer_live_query"`);

    await vi.waitFor(() => {
      expect(captureException).toHaveBeenCalledWith(error, { level: "error" });
    });
  });

  it("captures proposals for unsupported chains", async () => {
    const message = serialize({
      account,
      amount: 1n,
      chainId: 10,
      data: "0x",
      market,
      nonce: 0n,
      proposalType: ProposalType.None,
      timestamp: 0,
      unlock: 0n,
    });
    await redis.zadd("proposals", 0, message);
    const other = createBlockHook({
      alchemy: createAlchemy("webhooks"),
      database,
      executor: owner,
      manteca,
      onesignal: createOnesignal("onesignal"),
      persona,
      redis,
      source: "indexer",
    });
    await other.ready;

    await vi.waitFor(() => {
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "unsupported proposal chain 10" }),
        expect.objectContaining({ level: "error" }),
      );
    });
    await redis.zrem("proposals", message);
    await other.close();
  });
});

function logger(count: number): Hex {
  const loads = Array.from({ length: count }, (_, index) =>
    concatHex(["0x60", toHex((count - 1 - index) * 32, { size: 1 }), "0x35"]),
  );
  return concatHex([
    "0x60",
    toHex(count * 32, { size: 1 }),
    "0x3603",
    "0x80",
    "0x60",
    toHex(count * 32, { size: 1 }),
    "0x600037",
    ...loads,
    toHex(0x80 + count, { size: 1 }),
    "0x6000",
    toHex(0xa0 + count, { size: 1 }),
    "0x00",
  ]);
}

function captured(address: string) {
  return vi
    .mocked(captureException)
    .mock.calls.filter((call) => serialize(call).toLowerCase().includes(address.toLowerCase()));
}
