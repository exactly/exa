import { headerValidator } from "../mocks/alchemy";
import sendPushNotification from "../mocks/onesignal";
import "../mocks/sentry";
import "../mocks/wallet";

import { captureException, startSpan } from "@sentry/node";
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
  formatUnits,
  hexToBigInt,
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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import {
  auditorAbi,
  exaAccountFactoryAbi,
  exaAccountFactoryAddress,
  exaPluginAbi,
  exaPreviewerAbi,
  firewallAbi,
  marketAbi,
  networks,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import ProposalType from "@exactly/common/ProposalType";
import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";

import database from "../../database";
import { markets } from "../../database/indexer";
import createBlockHook from "../../hooks/block";
import t, { f } from "../../i18n";
import createAlchemy, { NETWORKS } from "../../utils/alchemy";
import ensClient from "../../utils/ensClient";
import createOnesignal from "../../utils/onesignal";
import redis from "../../utils/redis";
import wallet from "../../utils/wallet";

const anvil2 = NETWORKS.get("ANVIL2");
if (!anvil2) throw new Error("missing anvil2");
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
const hook = createBlockHook({
  alchemy: createAlchemy("webhooks"),
  database,
  executor: owner,
  onesignal: createOnesignal("onesignal"),
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
      address: parse(Address, networks.get(anvil2.id)?.exaPreviewer),
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
    vi.setSystemTime(Number(timestamp + 666n) * 1000);

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
    await target.setAutomine(true);
    await expect(target.waitForTransactionReceipt({ hash })).resolves.toMatchObject({ status: "success" });

    await vi.waitUntil(
      async () =>
        (await target.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [receiver] })) ===
        held,
      { timeout: 30_000, interval: 200 },
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "schedule proposal", attributes: expect.objectContaining({ account }) }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      expect.any(Function),
    );
    await vi.waitFor(
      () => {
        expect(sendPushNotification).toHaveBeenCalledWith({
          userId: account,
          headings: t("Withdraw completed"),
          contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
            amount: f(formatUnits(held, 6)),
            symbol: "USDC",
            recipient: shortenHex(receiver),
          }),
        });
      },
      { timeout: 30_000, interval: 200 },
    );
    await vi.waitUntil(() => queued().then((proposals) => proposals.length === 0), { timeout: 30_000, interval: 200 });
    expect(captured(account)).toStrictEqual([]);
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
      onesignal: createOnesignal("onesignal"),
      redis,
      source: "indexer",
    });
    await other.ready;

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
    await other.close();
    await vi.waitUntil(
      () =>
        queued().then((proposals) => proposals.some((proposal) => proposal.nonce === nonce && !proposal.retryCount)),
      { timeout: 30_000, interval: 200 },
    );
    for (const member of await redis.zrange("proposals", 0, -1)) {
      if (deserialize<{ account: string }>(member).account === account) await redis.zrem("proposals", member);
    }
  });

  it("ignores proposals from foreign emitters", async () => {
    const emitter = privateKeyToAccount(generatePrivateKey()).address;
    const topics = encodeEventTopics({
      abi: proposalManagerAbi,
      eventName: "Proposed",
      args: { account, nonce: 666n, market },
    }) as Hex[];
    await target.setCode({ address: emitter, bytecode: logger(topics.length) });
    const before = await queued();
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
    await expect(queued()).resolves.toStrictEqual(before);
  });

  it("drops the alchemy signing key", async () => {
    const other = createBlockHook({
      alchemy: createAlchemy("webhooks"),
      blockKey: "block",
      database,
      executor: owner,
      onesignal: createOnesignal("onesignal"),
      redis,
      source: "indexer",
    });
    await other.ready;

    expect(headerValidator).toHaveBeenLastCalledWith(new Set());
    await other.close();
  });

  it("keeps the alchemy signing key", async () => {
    const other = createBlockHook({
      alchemy: createAlchemy("webhooks"),
      blockKey: "block",
      database,
      executor: owner,
      onesignal: createOnesignal("onesignal"),
      redis,
    });
    await other.ready;

    expect(vi.mocked(headerValidator).mock.lastCall?.[0].has("block")).toBe(true);
    await expect(other.close()).resolves.toBeUndefined();
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
      onesignal: createOnesignal("onesignal"),
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
