import { createWebhook, findWebhook, headerValidator } from "../mocks/alchemy";
import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/sentry";
import "../mocks/traceClient";
import "../mocks/wallet";

import * as core from "@sentry/core";
import { captureException, getActiveSpan, setExtra, startSpan } from "@sentry/node";
import { serialize } from "@wagmi/core";
import { Queue } from "bullmq";
import { testClient } from "hono/testing";
import { createHash } from "node:crypto";
import { inspect } from "node:util";
import { parse } from "valibot";
import {
  createWalletClient,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodePacked,
  ExecutionRevertedError,
  getAbiItem,
  getAddress,
  hexToBigInt,
  hexToBytes,
  http,
  HttpRequestError,
  nonceManager,
  padHex,
  parseAbi,
  parseEventLogs,
  toEventSelector,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { entryPoint06Abi, entryPoint06Address, getUserOperationHash } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { optimism } from "viem/chains";
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain, {
  exaAccountFactoryAbi,
  exaAccountFactoryAddress,
  exaPluginAbi,
  exaPluginAddress,
  marketAbi,
  marketUSDCAddress,
  marketWETHAddress,
  proposalManagerAbi,
  proposalManagerAddress,
  upgradeableModularAccountAbi,
  usdcAddress,
} from "@exactly/common/generated/chain";
import * as nonceKey from "@exactly/common/nonceKey";
import ProposalType from "@exactly/common/ProposalType";
import * as validation from "@exactly/common/validation";

import database, { credentials } from "../../database";
import createBlockHook from "../../hooks/block";
import createAlchemy from "../../utils/alchemy";
import appOrigin from "../../utils/appOrigin";
import createPersona from "../../utils/persona";
import publicClient from "../../utils/publicClient";
import createManteca from "../../utils/ramps/manteca";
import redis, { bullmq } from "../../utils/redis";
import ServiceError from "../../utils/ServiceError";
import wallet from "../../utils/wallet";
import createProposal from "../../workers/proposal/queue";
import anvilClient from "../anvilClient";

import type { Job } from "../../workers/proposal/job";

let keeper: ReturnType<typeof wallet>;

const bob = createWalletClient({
  chain,
  transport: http(),
  account: privateKeyToAccount(padHex("0xb0b"), { nonceManager }),
});
const manteca = createManteca("manteca", "https://manteca.test");
const persona = createPersona("persona", "https://persona.test");
const settlement = parse(validation.Address, padHex("0x5e7", { size: 20 }));
const proposal = createProposal(redis);
const queue = new Queue<Job, void, "proposal">("proposal", { connection: bullmq });
const defaults = { alchemy: createAlchemy("webhooks"), database, manteca, persona, proposal, redis };
vi.mocked(findWebhook).mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- create path
const blockHook = createBlockHook(defaults);
const appClient = testClient(blockHook.app);

beforeAll(async () => {
  await blockHook.ready;
  keeper = wallet(privateKeyToAccount(padHex("0x69")));
});

afterAll(async () => {
  await Promise.all([queue.close(), proposal.close()]);
});

describe("initialization", () => {
  const existing: NonNullable<Awaited<ReturnType<typeof findWebhook>>> = {
    id: "existing",
    is_active: true,
    network: "ANVIL",
    signing_key: "existing-signing-key",
    webhook_type: "GRAPHQL",
    webhook_url: "http://localhost:8081/hooks/block",
  };

  it("starts with a discovered key when reconciliation fails", async () => {
    const error = new Error("creation failed");
    vi.mocked(findWebhook).mockResolvedValueOnce(existing);
    vi.mocked(createWebhook).mockRejectedValueOnce(error);
    const currentHook = createBlockHook(defaults);

    await expect(currentHook.ready).resolves.toBeDefined();
    expect(headerValidator).toHaveBeenLastCalledWith(new Set([existing.signing_key]));
    expect(captureException).toHaveBeenCalledWith(error, { level: "warning" });
  });

  it("keeps both keys when the old webhook deletion fails", async () => {
    vi.mocked(findWebhook).mockResolvedValueOnce(existing);
    const { fetch } = globalThis;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      (input instanceof Request ? input.url : String(input)).startsWith(
        "https://dashboard.alchemy.com/api/delete-webhook",
      )
        ? Promise.resolve(new Response("unavailable", { status: 503 }))
        : fetch(input, init),
    );
    const currentHook = createBlockHook(defaults);

    await expect(currentHook.ready).resolves.toBeDefined();
    expect(createWebhook).toHaveBeenCalledOnce();
    expect(headerValidator).toHaveBeenLastCalledWith(new Set([existing.signing_key, "mock-signing-key"]));
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Alchemy503", message: "unavailable", status: 503 }),
      { level: "warning" },
    );
  });

  it("keeps a webhook whose url carries its query hash", async () => {
    await createBlockHook(defaults).ready;
    const options = vi.mocked(createWebhook).mock.lastCall?.[0];
    if (!options || !("graphql_query" in options)) throw new Error("missing webhook");
    vi.mocked(createWebhook).mockClear();
    vi.mocked(findWebhook).mockResolvedValueOnce({ ...existing, webhook_url: options.webhook_url });
    const currentHook = createBlockHook(defaults);

    await expect(currentHook.ready).resolves.toBeDefined();
    expect(options.webhook_url).toBe(
      `${appOrigin}/hooks/block?query=${createHash("sha256").update(options.graphql_query.query).digest("hex")}`,
    );
    expect(options.graphql_query.query).toContain(
      `addresses: ${JSON.stringify([exaPluginAddress, proposalManagerAddress, marketUSDCAddress].toSorted())}`,
    );
    expect(options.graphql_query.query).toContain(`"${withdrawTopic}" # Withdraw`);
    expect(options.graphql_query.query).toMatch(/transaction \{\s+hash\s+\}/);
    expect(createWebhook).not.toHaveBeenCalled();
    expect(headerValidator).toHaveBeenLastCalledWith(new Set([existing.signing_key]));
    const predicate = vi.mocked(findWebhook).mock.lastCall?.[0];
    expect(
      [
        { ...existing, webhook_url: `${appOrigin}/hooks/block` },
        { ...existing, webhook_url: options.webhook_url },
        { ...existing, webhook_url: `${appOrigin}/hooks/blocks` },
        { ...existing, webhook_type: "ADDRESS_ACTIVITY" as const, webhook_url: options.webhook_url },
      ].map((webhook) => predicate?.(webhook)),
    ).toStrictEqual([true, true, false, false]);
  });

  it("watches a plugin whose proposal manager read reverts", async () => {
    const { readContract } = publicClient;
    vi.spyOn(publicClient, "readContract").mockImplementation((parameters) =>
      parameters.functionName === "proposalManager"
        ? Promise.reject(new ExecutionRevertedError())
        : readContract(parameters),
    );
    await createBlockHook(defaults).ready;
    const options = vi.mocked(createWebhook).mock.lastCall?.[0];
    if (!options || !("graphql_query" in options)) throw new Error("missing webhook");

    expect(options.graphql_query.query).toContain(
      `addresses: ${JSON.stringify([exaPluginAddress, proposalManagerAddress, marketUSDCAddress].toSorted())}`,
    );
  });

  it("watches the legacy factories and plugins on optimism", async () => {
    const bytecode = await anvilClient.getCode({ address: exaAccountFactoryAddress });
    if (!bytecode) throw new Error("missing factory");
    await anvilClient.setCode({
      address: legacyFactory,
      bytecode: bytecode.replaceAll(
        exaPluginAddress.slice(2).toLowerCase(),
        legacyFactoryPlugin.slice(2).toLowerCase(),
      ) as Hex,
    });
    onTestFinished(() => anvilClient.setCode({ address: legacyFactory, bytecode: "0x" }));
    await createBlockHook({ ...defaults, chainId: optimism.id }).ready;
    const options = vi.mocked(createWebhook).mock.lastCall?.[0];
    if (!options || !("graphql_query" in options)) throw new Error("missing webhook");

    expect(options.graphql_query.query).toContain(
      `addresses: ${JSON.stringify(
        [exaPluginAddress, proposalManagerAddress, marketUSDCAddress, legacyFactoryPlugin, ...legacyPlugins].toSorted(),
      )}`,
    );
  });

  it("fails without a signing key when initialization fails", async () => {
    const error = new Error("discovery failed");
    vi.mocked(findWebhook).mockRejectedValueOnce(error);
    const currentHook = createBlockHook(defaults);

    await expect(currentHook.ready).rejects.toBe(error);
  });
});

describe("validation", () => {
  it("accepts valid request", async () => {
    const response = await appClient.index.$post(blockPayload);

    expect(response.status).toBe(200);
  });

  it("skips credentials lookup without proposals", async () => {
    const findMany = vi.spyOn(database.query.credentials, "findMany");

    const response = await appClient.index.$post({
      header: {},
      json: {
        type: "GRAPHQL",
        event: {
          data: {
            block: {
              number: 1,
              timestamp: 1,
              logs: [{ topics: [zeroHash], data: "0x", account: { address: proposalManagerAddress } }],
            },
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe("proposal", () => {
  const proposer = deriveAddress(exaAccountFactoryAddress, { x: padHex("0xb10c"), y: zeroHash });
  const receiver = getAddress(padHex("0xcafe", { size: 20 }));
  const unlock = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
  let nonce = 0n;

  beforeAll(async () => {
    await database.insert(credentials).values({
      id: "block-proposer",
      publicKey: new Uint8Array(hexToBytes(proposer)),
      account: proposer,
      factory: exaAccountFactoryAddress,
    });
  });

  function proposedLog(
    proposalType: number,
    amount: bigint,
    data: Hex,
    emitter: Address = proposalManagerAddress,
    current = (nonce += 1n),
  ) {
    return {
      topics: encodeEventTopics({
        abi: proposalManagerAbi,
        eventName: "Proposed",
        args: { account: proposer, nonce: current, market: marketUSDCAddress },
      }) as [Hex, ...Hex[]],
      data: encodeAbiParameters(
        [{ type: "uint8" }, { type: "uint256" }, { type: "bytes" }, { type: "uint256" }],
        [proposalType, amount, data, unlock],
      ),
      account: { address: emitter },
    };
  }

  function withdrawal(emitter?: Address) {
    return proposedLog(
      ProposalType.Withdraw,
      3_000_000n,
      encodeAbiParameters([{ type: "address" }], [receiver]),
      emitter,
    );
  }

  function scheduled(add: ReturnType<typeof spyAdd>) {
    return add(proposer, "proposal").map(({ jobId }) => jobId);
  }

  it("schedules proposals in nonce order", async () => {
    const add = spyAdd();
    const later = nonce + 2n;
    const earlier = nonce + 1n;
    nonce += 2n;

    const response = await post([
      proposedLog(ProposalType.Swap, 20n, "0x", proposalManagerAddress, later),
      proposedLog(
        ProposalType.Withdraw,
        10n,
        encodeAbiParameters([{ type: "address" }], [receiver]),
        proposalManagerAddress,
        earlier,
      ),
    ]);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(scheduled(add)).toStrictEqual([`${proposer}-${earlier}-0`, `${proposer}-${later}-0`]);
    const job = await queue.getJob(`${proposer}-${earlier}-0`);
    if (!job) throw new Error("job not found");
    expect(job.data).toStrictEqual({
      account: proposer,
      amount: "10",
      data: encodeAbiParameters([{ type: "address" }], [receiver]),
      market: marketUSDCAddress,
      nonce: String(earlier),
      proposalType: ProposalType.Withdraw,
      retryCount: 0,
      timestamp: withdrawProposal.json.event.data.block.timestamp,
      unlock: String(unlock),
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    await expect(job.getState()).resolves.toBe("delayed");
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "schedule proposal", op: "queue.publish" }),
      expect.any(Function),
    );
    await Promise.all([queue.remove(`${proposer}-${earlier}-0`), queue.remove(`${proposer}-${later}-0`)]);
  });

  it("captures invalid proposals without scheduling them", async () => {
    const add = spyAdd();

    const response = await post([proposedLog(99, 1n, "0x")]);

    expect(response.status).toBe(200);
    expect(scheduled(add)).toStrictEqual([]);
    expect(captureException).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ kind: "schema", type: "enum" })]),
      { level: "error" },
    );
  });

  it("ignores proposals emitted by another contract", async () => {
    const add = spyAdd();
    const ignored = withdrawal(marketUSDCAddress);

    const response = await post([ignored]);

    expect(response.status).toBe(200);
    expect(scheduled(add)).toStrictEqual([]);
  });

  it("schedules proposals emitted by a legacy plugin on optimism", async () => {
    const add = spyAdd();
    const currentHook = createBlockHook({ ...defaults, chainId: optimism.id });
    await currentHook.ready;

    const response = await testClient(currentHook.app).index.$post(blockPayloadWith([withdrawal(legacyPlugins[0])]));

    expect(response.status).toBe(200);
    expect(scheduled(add)).toStrictEqual([`${proposer}-${nonce}-0`]);
    await queue.remove(`${proposer}-${nonce}-0`);
  });

  it.each([
    ["an unknown error", new Error("rpc unavailable")],
    ["an rpc error", new HttpRequestError({ url: "https://rpc.test" })],
  ])("fails until the emitters can be read after %s", async (_, error) => {
    const { readContract } = publicClient;
    const lookup = vi
      .spyOn(publicClient, "readContract")
      .mockImplementation((parameters) =>
        parameters.functionName === "EXA_PLUGIN" ? Promise.reject(error) : readContract(parameters),
      );
    const add = spyAdd();
    const currentHook = createBlockHook(defaults);
    const currentClient = testClient(currentHook.app);
    await currentHook.ready.catch(() => undefined);
    const logs = [withdrawal()];

    const response = await currentClient.index.$post(blockPayloadWith(logs));

    expect(response.status).toBe(500);
    expect(scheduled(add)).toStrictEqual([]);
    lookup.mockRestore();

    const retried = await currentClient.index.$post(blockPayloadWith(logs));

    expect(retried.status).toBe(200);
    expect(scheduled(add)).toStrictEqual([`${proposer}-${nonce}-0`]);
    await queue.remove(`${proposer}-${nonce}-0`);
  });

  it("schedules the proposal with a withdraw in the block", async () => {
    const add = spyAdd();
    const getSettlements = vi.spyOn(manteca, "getSettlements").mockResolvedValueOnce({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");

    const response = await appClient.index.$post(
      withLogs([withdrawal(), withdrawLog({ receiver: getAddress(padHex("0x69", { size: 20 })), owner: proposer })]),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(scheduled(add)).toStrictEqual([`${proposer}-${nonce}-0`]);
    expect(getSettlements).toHaveBeenCalledOnce();
    expect(getPaymentLock).not.toHaveBeenCalled();
    expect(setExtra).not.toHaveBeenCalledWith("exa.ignore", true);
    await queue.remove(`${proposer}-${nonce}-0`);
  });

  it("schedules the proposal when settlements fail", async () => {
    const add = spyAdd();
    const getSettlements = vi.spyOn(manteca, "getSettlements").mockRejectedValueOnce(new Error("manteca down"));

    const response = await appClient.index.$post(
      withLogs([withdrawal(), withdrawLog({ receiver: settlement, owner: proposer })]),
    );

    expect(response.status).toBe(500);
    expect(scheduled(add)).toStrictEqual([`${proposer}-${nonce}-0`]);
    expect(getSettlements).toHaveBeenCalledOnce();
    expect(setExtra).not.toHaveBeenCalledWith("exa.ignore", true);
    await queue.remove(`${proposer}-${nonce}-0`);
  });

  it("moves scheduled messages from redis into the queue", async () => {
    const stale = getAddress(padHex("0x57a1e", { size: 20 }));
    const proposed = serialize({
      account: stale,
      amount: 40n,
      data: "0x",
      id: "legacy",
      market: marketUSDCAddress,
      nonce: 4n,
      proposalType: ProposalType.Swap,
      retryCount: 2,
      sentryTrace: "trace",
      timestamp: 1,
      unlock,
    });
    const withdrawn = serialize({ account: stale, amount: 50n, market: marketUSDCAddress, receiver, unlock });
    const invalid = serialize({ account: stale, amount: 60n, market: marketUSDCAddress, unlock });
    await Promise.all([
      redis.zadd("proposals", Number(unlock), proposed),
      redis.zadd("withdraw", 1, invalid, Number(unlock), withdrawn),
    ]);

    await createBlockHook(defaults).ready;

    await expect(redis.zscore("proposals", proposed)).resolves.toBeNull(); // cspell:ignore zscore
    await expect(redis.zscore("withdraw", withdrawn)).resolves.toBeNull();
    await expect(redis.zscore("withdraw", invalid)).resolves.toBe("1");
    expect(captureException).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ kind: "schema", path: [expect.objectContaining({ key: "receiver" })] }),
      ]),
      { level: "error", contexts: { migrate: { key: "withdraw" } } },
    );
    const [proposalJob, withdrawJob] = await Promise.all([
      queue.getJob(`${stale}-4-2`),
      queue.getJob(`${stale}-${marketUSDCAddress}-${unlock}`),
    ]);
    expect(proposalJob?.data).toStrictEqual({
      account: stale,
      amount: "40",
      data: "0x",
      market: marketUSDCAddress,
      nonce: "4",
      proposalType: ProposalType.Swap,
      retryCount: 2,
      timestamp: 1,
      unlock: String(unlock),
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(withdrawJob?.data).toStrictEqual({
      account: stale,
      amount: "50",
      market: marketUSDCAddress,
      receiver,
      retryCount: 0,
      unlock: String(unlock),
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    await Promise.all([proposalJob?.remove(), withdrawJob?.remove(), redis.zrem("withdraw", invalid)]);
  });
});

describe("legacy withdraw", () => {
  const withdrawUnlock = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
  const withdrawOwner = padHex("0xdead", { size: 20 });
  const withdrawAccount = deriveAddress(exaAccountFactoryAddress, { x: padHex(withdrawOwner), y: zeroHash });
  const withdrawMarket = getAddress(padHex("0xbeef", { size: 20 }));
  const withdrawReceiver = getAddress(padHex("0xcafe", { size: 20 }));

  beforeAll(async () => {
    await database.insert(credentials).values({
      id: "legacy-withdraw",
      publicKey: new Uint8Array(hexToBytes(withdrawOwner)),
      account: withdrawAccount,
      factory: exaAccountFactoryAddress,
    });
  });

  function legacyPayload(amount: bigint, account: Address = withdrawAccount, emitter: Address = exaPluginAddress) {
    return {
      header: {},
      json: {
        type: "GRAPHQL" as const,
        event: {
          data: {
            block: {
              number: 1,
              timestamp: Number(withdrawUnlock),
              logs: [
                {
                  topics: [
                    "0x0c652a21d96e4efed065c3ef5961e4be681be99b95dd55126669ae9be95767e0",
                    encodeAbiParameters([{ type: "address" }], [account]),
                    encodeAbiParameters([{ type: "address" }], [withdrawMarket]),
                    encodeAbiParameters([{ type: "address" }], [withdrawReceiver]),
                  ] as [Hex, ...Hex[]],
                  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [amount, withdrawUnlock]),
                  account: { address: emitter },
                },
              ],
            },
          },
        },
      },
    };
  }

  it("schedules legacy withdraws", async () => {
    const add = spyAdd();

    const response = await appClient.index.$post(legacyPayload(1_500_000n));

    expect(response.status).toBe(200);
    expect(add(withdrawAccount, "withdraw").map(({ jobId }) => jobId)).toStrictEqual([
      `${withdrawAccount}-${withdrawMarket}-${withdrawUnlock}`,
    ]);
    const job = await queue.getJob(`${withdrawAccount}-${withdrawMarket}-${withdrawUnlock}`);
    if (!job) throw new Error("job not found");
    expect(job.data).toStrictEqual({
      account: withdrawAccount,
      amount: "1500000",
      market: withdrawMarket,
      receiver: withdrawReceiver,
      retryCount: 0,
      timestamp: Number(withdrawUnlock),
      unlock: String(withdrawUnlock),
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    await expect(job.getState()).resolves.toBe("delayed");
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "schedule withdraw", op: "queue.publish" }),
      expect.any(Function),
    );
    await job.remove();
  });

  it("ignores withdrawals emitted by an untrusted contract", async () => {
    const add = spyAdd();

    const response = await appClient.index.$post(legacyPayload(1_500_000n, withdrawAccount, zeroAddress));

    expect(response.status).toBe(200);
    expect(add(withdrawAccount)).toStrictEqual([]);
  });

  it("ignores proposals from unknown accounts", async () => {
    const unknownAccount = getAddress(padHex("0xbad", { size: 20 }));
    const proposed = getAbiItem({ abi: proposalManagerAbi, name: "Proposed" });
    const setAttribute = vi.fn();
    vi.mocked(getActiveSpan).mockReturnValue({ setAttribute } as unknown as ReturnType<typeof getActiveSpan>);
    onTestFinished(() => {
      vi.mocked(getActiveSpan).mockReset();
    });
    const add = spyAdd();
    const payload = legacyPayload(1n, unknownAccount);
    payload.json.event.data.block.logs.push({
      topics: encodeEventTopics({
        abi: [proposed],
        args: { account: unknownAccount, nonce: 0n, market: withdrawMarket },
      }) as [Hex, ...Hex[]],
      data: encodeAbiParameters(
        proposed.inputs.filter(({ indexed }) => !indexed),
        [ProposalType.Withdraw, 1n, encodeAbiParameters([{ type: "address" }], [unknownAccount]), withdrawUnlock],
      ),
      account: { address: proposalManagerAddress },
    });

    const response = await appClient.index.$post(payload);

    expect(response.status).toBe(200);
    expect(add(unknownAccount)).toStrictEqual([]);
    expect(setAttribute).toHaveBeenCalledWith("exa.unknown", [unknownAccount]);
    expect(vi.mocked(captureException).mock.calls.filter((call) => inspect(call).includes(unknownAccount))).toEqual([]);
    expect(sendPushNotificationMock).not.toHaveBeenCalledWith(expect.objectContaining({ userId: unknownAccount }));
  });

  async function createFactoryAccount() {
    const owner = privateKeyToAccount(generatePrivateKey());
    const account = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner.address), y: zeroHash });
    await keeper.exaSend(
      { name: "create account", op: "exa.account" },
      {
        address: exaAccountFactoryAddress,
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(owner.address), y: 0n }]],
      },
    );
    return account;
  }

  async function payloadAtHead(amount: bigint, account: Address) {
    const payload = legacyPayload(amount, account);
    payload.json.event.data.block.number = Number(await publicClient.getBlockNumber({ cacheTime: 0 }));
    return payload;
  }

  async function proposedAtHead(account: Address) {
    const payload = await payloadAtHead(1n, withdrawAccount);
    payload.json.event.data.block.logs = [proposedLog(account)];
    return payload;
  }

  function proposedLog(account: Address) {
    const proposed = getAbiItem({ abi: proposalManagerAbi, name: "Proposed" });
    return {
      topics: encodeEventTopics({
        abi: [proposed],
        args: { account, nonce: 0n, market: withdrawMarket },
      }) as [Hex, ...Hex[]],
      data: encodeAbiParameters(
        proposed.inputs.filter(({ indexed }) => !indexed),
        [ProposalType.Withdraw, 1n, encodeAbiParameters([{ type: "address" }], [account]), withdrawUnlock],
      ),
      account: { address: proposalManagerAddress },
    };
  }

  it("schedules proposals from factory accounts without credentials", async () => {
    const account = await createFactoryAccount();
    const payload = await payloadAtHead(1n, account);
    payload.json.event.data.block.logs = [proposedLog(account)];
    const add = spyAdd();
    const setAttribute = spySetAttribute();

    const response = await appClient.index.$post(payload);

    expect(response.status).toBe(200);
    expect(add(account, "proposal")).toHaveLength(1);
    expect(setAttribute).not.toHaveBeenCalledWith("exa.unknown", expect.anything());
    expect(capturedFor(account)).toEqual([]);
  });

  it("looks up each factory account once", async () => {
    const account = await createFactoryAccount();
    const lookups = vi.spyOn(publicClient, "getLogs");
    const add = spyAdd();
    const setAttribute = spySetAttribute();

    const first = await appClient.index.$post(await payloadAtHead(1_100_000n, account));
    const second = await appClient.index.$post(await payloadAtHead(1_200_000n, account));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(lookups.mock.calls.filter(([parameters]) => inspect(parameters?.args).includes(account))).toHaveLength(1);
    expect(add(account, "withdraw").map(({ amount }) => amount)).toStrictEqual(["1100000", "1200000"]);
    expect(setAttribute).not.toHaveBeenCalledWith("exa.unknown", expect.anything());
  });

  it("keeps settled batches when another batch fails", async () => {
    const account = await createFactoryAccount();
    const accounts = [account, ...Array.from({ length: 100 }, () => privateKeyToAccount(generatePrivateKey()).address)];
    const payload = await payloadAtHead(1n, withdrawAccount);
    payload.json.event.data.block.logs = accounts.map((address) => proposedLog(address));
    const original = publicClient.getLogs.bind(publicClient);
    const lookups = vi
      .spyOn(publicClient, "getLogs")
      .mockImplementation((parameters) =>
        inspect(parameters?.args).includes(account) ? original(parameters) : Promise.reject(new Error("rpc failure")),
      );

    const add = spyAdd();
    const setAttribute = spySetAttribute();

    const failed = await appClient.index.$post(payload);
    const queuedOnFailure = add(account);
    lookups.mockClear();
    lookups.mockImplementation(original);
    const retried = await appClient.index.$post(payload);

    expect(failed.status).toBe(500);
    expect(queuedOnFailure).toEqual([]);
    expect(retried.status).toBe(200);
    expect(lookups.mock.calls.map(([parameters]) => parameters?.args)).toEqual([{ account: accounts.slice(100) }]);
    expect(add(account, "proposal")).toHaveLength(1);
    expect(accounts.slice(1).flatMap((foreign) => add(foreign))).toStrictEqual([]);
    expect(setAttribute.mock.calls.filter(([key]) => key === "exa.unknown")).toEqual([
      ["exa.unknown", accounts.slice(1)],
    ]);
  });

  it("looks up each foreign account once", async () => {
    const account = privateKeyToAccount(generatePrivateKey()).address;
    const lookups = vi.spyOn(publicClient, "getLogs");
    const add = spyAdd();
    const setAttribute = spySetAttribute();

    const first = await appClient.index.$post(await proposedAtHead(account));
    const second = await appClient.index.$post(await proposedAtHead(account));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(lookups.mock.calls.filter(([parameters]) => inspect(parameters?.args).includes(account))).toHaveLength(1);
    expect(add(account)).toStrictEqual([]);
    expect(setAttribute.mock.calls.filter(([key]) => key === "exa.unknown")).toEqual([
      ["exa.unknown", [account]],
      ["exa.unknown", [account]],
    ]);
    expect(capturedFor(account)).toEqual([]);
  });

  it("looks up a foreign account again after a while", async () => {
    const account = privateKeyToAccount(generatePrivateKey()).address;
    const lookups = vi.spyOn(publicClient, "getLogs");
    const add = spyAdd();
    const setAttribute = spySetAttribute();

    const first = await appClient.index.$post(await proposedAtHead(account));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5 * 60_000);
    const second = await appClient.index.$post(await proposedAtHead(account));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(lookups.mock.calls.filter(([parameters]) => inspect(parameters?.args).includes(account))).toHaveLength(2);
    expect(add(account)).toStrictEqual([]);
    expect(setAttribute.mock.calls.filter(([key]) => key === "exa.unknown")).toEqual([
      ["exa.unknown", [account]],
      ["exa.unknown", [account]],
    ]);
    expect(capturedFor(account)).toEqual([]);
  });

  it("looks up every account in batches", async () => {
    const account = await createFactoryAccount();
    const accounts = [...Array.from({ length: 100 }, () => privateKeyToAccount(generatePrivateKey()).address), account];
    const payload = await payloadAtHead(1n, withdrawAccount);
    payload.json.event.data.block.logs = accounts.map((address) => proposedLog(address));
    const lookups = vi.spyOn(publicClient, "getLogs");
    const add = spyAdd();
    const setAttribute = spySetAttribute();

    const response = await appClient.index.$post(payload);

    expect(response.status).toBe(200);
    expect(lookups.mock.calls.map(([parameters]) => parameters?.args)).toEqual([
      { account: accounts.slice(0, 100) },
      { account: [account] },
    ]);
    expect(add(account, "proposal")).toHaveLength(1);
    expect(accounts.slice(0, 100).flatMap((foreign) => add(foreign))).toStrictEqual([]);
    expect(setAttribute.mock.calls.filter(([key]) => key === "exa.unknown")).toEqual([
      ["exa.unknown", accounts.slice(0, 100)],
    ]);
  });

  it("schedules withdrawals from factory accounts without a block number", async () => {
    const account = await createFactoryAccount();
    const payload = legacyPayload(1_312_500n, account);
    const { number: _, ...block } = payload.json.event.data.block;
    const add = spyAdd();
    const setAttribute = spySetAttribute();

    const response = await appClient.index.$post({
      ...payload,
      json: { ...payload.json, event: { ...payload.json.event, data: { ...payload.json.event.data, block } } },
    });

    expect(response.status).toBe(200);
    expect(add(account, "withdraw")).toHaveLength(1);
    expect(setAttribute).not.toHaveBeenCalledWith("exa.unknown", expect.anything());
    expect(capturedFor(account)).toEqual([]);
  });

  it("fails without queueing when the rpc is behind the block", async () => {
    const account = await createFactoryAccount();
    const payload = await payloadAtHead(1_375_000n, account);
    payload.json.event.data.block.number += 1000;
    const add = spyAdd();

    const response = await appClient.index.$post(payload);

    expect(response.status).toBe(500);
    expect(add(account)).toEqual([]);
  });

  it("schedules withdrawals from factory accounts without credentials", async () => {
    const account = await createFactoryAccount();
    const add = spyAdd();
    const setAttribute = spySetAttribute();

    const response = await appClient.index.$post(await payloadAtHead(1_250_000n, account));

    expect(response.status).toBe(200);
    expect(add(account, "withdraw")).toHaveLength(1);
    expect(setAttribute).not.toHaveBeenCalledWith("exa.unknown", expect.anything());
    expect(capturedFor(account)).toEqual([]);
  });

  it("fails without queueing when credentials lookup fails", async () => {
    const add = spyAdd();
    vi.spyOn(database.query.credentials, "findMany").mockReturnValueOnce(
      Promise.reject(new Error("credentials lookup failed")) as never,
    );

    const response = await appClient.index.$post(legacyPayload(1_125_000n));

    expect(response.status).toBe(500);
    expect(add(withdrawAccount)).toStrictEqual([]);
  });
});

describe("qr payment", () => {
  const payer = deriveAddress(exaAccountFactoryAddress, {
    x: padHex(privateKeyToAddress(padHex("0xa11ce"))),
    y: zeroHash,
  });
  const code = "8d0f05d6-fb17-4adc-8003-de9a0ec9c77a";
  const nonce = BigInt(nonceKey.encode(code)) << 64n;
  const userOpHash = padHex("0x4337", { size: 32 });
  const hash = padHex("0x7e", { size: 32 });
  const lock = {
    code,
    type: "QR3",
    companyId: "68a6270d62a6d9f582f40c00",
    userId: "6adff39f0ee31861fc20cdaf",
    userNumberId: "100114168",
    userExternalId: "Exactly-argentina",
    sender: { exchange: "ARGENTINA", legalId: "30123456", name: "Jane", surname: "Doe" },
    paymentRecipientName: "Ricardo Fort",
    paymentRecipientLegalId: "20505736195",
    paymentAssetAmount: "1706.37",
    paymentAsset: "ARS",
    paymentPrice: "696.70000000",
    paymentAgainstAmount: "2.44921774",
    expireAt: "2026-11-11T11:33:26.000-03:00",
    creationTime: "2026-11-11T11:28:26.096-03:00",
  };
  const synthetic = {
    id: "synthetic",
    numberId: "70009",
    externalId: userOpHash,
    status: "STARTING" as const,
    type: "QR3_PAYMENT",
  };
  const stranger = getAddress(padHex("0x57a", { size: 20 }));
  const payment = withdrawLog({ receiver: settlement, owner: payer, hash });

  beforeAll(async () => {
    await database.insert(credentials).values({
      id: "block-qr",
      publicKey: new Uint8Array(hexToBytes(payer)),
      account: payer,
      factory: exaAccountFactoryAddress,
    });
  });

  it("executes a payment made onchain", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const account = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner.address), y: zeroHash });
    await database.insert(credentials).values({
      id: "block-qr-onchain",
      publicKey: new Uint8Array(hexToBytes(owner.address)),
      account,
      factory: exaAccountFactoryAddress,
    });
    await keeper.exaSend(
      { name: "create account", op: "exa.account" },
      {
        address: exaAccountFactoryAddress,
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(owner.address), y: 0n }]],
      },
    );
    await keeper.exaSend(
      { name: "mint usdc", op: "exa.usdc" },
      {
        address: usdcAddress,
        abi: parseAbi(["function mint(address to, uint256 amount)"]),
        functionName: "mint",
        args: [account, 3_000_000n],
      },
    );
    await keeper.exaSend(
      { name: "poke", op: "exa.poke" },
      { address: account, abi: exaPluginAbi, functionName: "poke", args: [marketUSDCAddress] },
    );
    await anvilClient.setBalance({ address: account, value: 10n ** 18n });
    const userOperation = {
      sender: account,
      nonce: await publicClient.readContract({
        address: entryPoint06Address,
        abi: entryPoint06Abi,
        functionName: "getNonce",
        args: [account, BigInt(nonceKey.encode(code))],
      }),
      initCode: "0x",
      callData: encodeFunctionData({
        abi: upgradeableModularAccountAbi,
        functionName: "execute",
        args: [
          marketUSDCAddress,
          0n,
          encodeFunctionData({ abi: marketAbi, functionName: "withdraw", args: [2_449_218n, settlement, account] }),
        ],
      }),
      callGasLimit: 1_000_000n,
      verificationGasLimit: 1_000_000n,
      preVerificationGas: 100_000n,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000n,
      paymasterAndData: "0x",
      signature: "0x",
    } as const;
    const receipt = await keeper.exaSend(
      { name: "handle ops", op: "exa.ops" },
      {
        address: entryPoint06Address,
        abi: entryPoint06Abi,
        functionName: "handleOps",
        args: [
          [
            {
              ...userOperation,
              signature: encodePacked(
                ["uint8", "bytes"],
                [
                  0,
                  await owner.signMessage({
                    message: {
                      raw: getUserOperationHash({
                        chainId: chain.id,
                        entryPointAddress: entryPoint06Address,
                        entryPointVersion: "0.6",
                        userOperation,
                      }),
                    },
                  }),
                ],
              ),
            },
          ],
          bob.account.address,
        ],
      },
    );
    if (!receipt) throw new Error("missing receipt");
    const [operation] = parseEventLogs({ abi: entryPoint06Abi, eventName: "UserOperationEvent", logs: receipt.logs });
    const [withdraw] = parseEventLogs({ abi: marketAbi, eventName: "Withdraw", logs: receipt.logs });
    if (!operation || !withdraw) throw new Error("missing logs");
    expect(operation.args).toMatchObject({ sender: account, nonce: userOperation.nonce, success: true });
    expect(withdraw.args).toStrictEqual({
      caller: account,
      receiver: settlement,
      owner: account,
      assets: 2_449_218n,
      shares: withdraw.args.shares,
    });
    const getSettlements = vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(lock);
    const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValueOnce(basicAccount);
    const getSettlement = vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment").mockResolvedValueOnce(synthetic);

    const response = await appClient.index.$post(
      withLogs([
        {
          topics: withdraw.topics as [Hex, ...Hex[]],
          data: withdraw.data,
          account: { address: withdraw.address },
          transaction: { hash: receipt.transactionHash },
        },
      ]),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(getSettlements).toHaveBeenCalledTimes(2);
    expect(getPaymentLock).toHaveBeenCalledExactlyOnceWith(code);
    expect(getAccount).toHaveBeenCalledExactlyOnceWith("block-qr-onchain", "basic");
    expect(getSettlement).toHaveBeenCalledExactlyOnceWith("ARS");
    expect(executeQrPayment).toHaveBeenCalledExactlyOnceWith(code, operation.args.userOpHash);
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    expect(setExtra).not.toHaveBeenCalledWith("exa.ignore", true);
  });

  it("pays only the user operations of the payment", async () => {
    const getTransactionReceipt = vi
      .spyOn(publicClient, "getTransactionReceipt")
      .mockResolvedValueOnce(
        transactionReceipt(hash, [
          receiptLog({ receiver: settlement, owner: payer }),
          operationLog({ sender: payer, nonce }),
          operationLog({ sender: stranger, nonce }),
          operationLog({ sender: payer, nonce, address: padHex("0xe4", { size: 20 }) }),
          operationLog({ sender: payer, nonce: 0n }),
        ]),
      );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(lock);
    vi.spyOn(persona, "getAccount").mockResolvedValueOnce(basicAccount);
    vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment").mockResolvedValueOnce(synthetic);

    const response = await appClient.index.$post(withLogs([payment, payment]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(getTransactionReceipt).toHaveBeenCalledExactlyOnceWith({ hash });
    expect(getPaymentLock).toHaveBeenCalledExactlyOnceWith(code);
    expect(executeQrPayment).toHaveBeenCalledExactlyOnceWith(code, userOpHash);
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each([
    ["I1234562", "i1234562"],
    ["30.123.456", "30123456"],
    ["1234.5678-A", "12345678a"],
  ])("pays a payer whose document %s manteca returns as %s", async (document, legalId) => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ BRL: settlement });
    mockLock(
      Response.json({
        code,
        type: "PIX",
        companyId: "68a6270d62a6d9f582f40c00",
        userId: "6adff3dadff8e3ababa6f482",
        userNumberId: "100114169",
        userExternalId: "Exactly-brazil",
        sender: { exchange: "ARGENTINA", legalId, name: "ALEXANDER J", surname: "SAMPLE" },
        paymentRecipientName: "TEST USER",
        paymentRecipientLegalId: "123******09",
        paymentAssetAmount: "1.00",
        paymentAsset: "BRL",
        paymentPrice: "5.81800000",
        paymentEffectivePrice: "5.81800004",
        paymentAgainstAmount: "0.17188037",
        paymentAgainst: "USDC",
        expireAt: "2026-11-19T10:08:16.000-03:00",
        creationTime: "2026-11-19T10:03:16.778-03:00",
      }),
    );
    vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
      ...basicAccount,
      attributes: {
        ...basicAccount.attributes,
        fields: {
          ...basicAccount.attributes.fields,
          documents: {
            value: [
              {
                value: {
                  id_class: { value: "id" },
                  id_number: { value: document },
                  id_issuing_country: { value: "AR" },
                  id_document_id: { value: "doc_id" },
                },
              },
            ],
          },
        },
      },
    });
    const getSettlement = vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment").mockResolvedValueOnce(synthetic);

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(getSettlement).toHaveBeenCalledExactlyOnceWith("BRL");
    expect(executeQrPayment).toHaveBeenCalledExactlyOnceWith(code, userOpHash);
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("executes once when the hook redelivers the payment", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValue(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockResolvedValue(lock);
    vi.spyOn(persona, "getAccount").mockResolvedValue(basicAccount);
    vi.spyOn(manteca, "getSettlement").mockResolvedValue(settlement);
    const { fetch: realFetch } = globalThis;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (input === "https://manteca.test/crypto/v2/synthetics/qr-payment") {
        return Promise.resolve(
          fetch.mock.calls.some(([url], index, calls) => url === input && index < calls.length - 1)
            ? Response.json({ internalStatus: "SYNTHETIC_EXISTS", message: "Synthetic exists" }, { status: 409 })
            : Response.json(synthetic),
        );
      }
      if (input === `https://manteca.test/crypto/v2/synthetics/${userOpHash}`) {
        return Promise.resolve(Response.json(synthetic));
      }
      return realFetch(input, init);
    });

    const first = await appClient.index.$post(withLogs([payment]));
    const second = await appClient.index.$post(withLogs([payment]));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const executions = fetch.mock.calls.filter(
      ([url]) => url === "https://manteca.test/crypto/v2/synthetics/qr-payment",
    );
    expect(executions.map(([, init]) => init?.body)).toStrictEqual([
      JSON.stringify({ qrCode: code, externalId: userOpHash, skipDeposit: true }),
      JSON.stringify({ qrCode: code, externalId: userOpHash, skipDeposit: true }),
    ]);
    expect(fetch).toHaveBeenCalledWith(
      `https://manteca.test/crypto/v2/synthetics/${userOpHash}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a payment below the lock amount",
      { assets: 2_449_217n },
      basicAccount,
      lock,
      { amount: "2449217", cause: "amount", assets: "2449217", lock: "2.44921774" },
    ],
    [
      "another payer",
      {},
      basicAccount,
      { ...lock, sender: { ...lock.sender, legalId: "99999999" } },
      { cause: "payer", persona: "act_qr" },
    ],
    ["a payer without national id", {}, passportAccount, lock, { cause: "payer", persona: "act_qr" }],
    ["a payer without persona account", {}, undefined, lock, { cause: "payer" }],
    ["a lock without sender", {}, basicAccount, { ...lock, sender: undefined }, { cause: "payer", persona: "act_qr" }],
  ] as const)("reports %s without executing", async (_, override, account, paymentLock, details) => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer, ...override }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(paymentLock);
    const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValueOnce(account);
    vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(getAccount).toHaveBeenCalledExactlyOnceWith("block-qr", "basic");
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(core.captureException).toHaveBeenCalledExactlyOnceWith(new Error("qr payment not executed"), {
      level: "error",
      contexts: { payment: { account: payer, userOpHash, amount: "2449218", ...details } },
    });
  });

  it("reports a payment without the lock in the nonce key", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce: 0n }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(getPaymentLock).not.toHaveBeenCalled();
    expect(core.captureException).toHaveBeenCalledExactlyOnceWith(
      new Error("usdc sent to settlement without qr lock"),
      {
        level: "error",
        contexts: { payment: { account: payer, userOpHash, amount: "2449218" } },
      },
    );
    expect(core.captureException).not.toHaveBeenCalledWith(new Error("qr payment not executed"), expect.anything());
  });

  it.each([
    ["receiver", { receiver: stranger }],
    ["owner", { owner: stranger }],
    ["market", { address: marketWETHAddress }],
  ] as const)("ignores a payment to the wrong %s without reporting", async (_, override) => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer, ...override }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(lock);
    vi.spyOn(persona, "getAccount").mockResolvedValueOnce(basicAccount);
    vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("ignores a failed user operation before reading the lock", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce, success: false }),
      ]),
    );
    const getSettlements = vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(getSettlements).toHaveBeenCalledOnce();
    expect(getPaymentLock).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
  });

  it("ignores a payment whose lock expired after the execute", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(null);
    const getSynthetic = vi.spyOn(manteca, "getSynthetic").mockResolvedValueOnce({ ...synthetic, status: "COMPLETED" });
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(getSynthetic).toHaveBeenCalledExactlyOnceWith(userOpHash);
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
  });

  it("fails a payment when the receipt lookup fails for redelivery", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockRejectedValueOnce(new Error("rpc down"));
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(500);
    expect(getPaymentLock).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
  });

  it("ignores withdraws that are not payments", async () => {
    const getTransactionReceipt = vi.spyOn(publicClient, "getTransactionReceipt");
    const getSettlements = vi.spyOn(manteca, "getSettlements").mockResolvedValueOnce({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");

    const response = await appClient.index.$post(
      withLogs([
        withdrawLog({ receiver: getAddress(padHex("0xca7d", { size: 20 })), owner: payer, hash }),
        { ...withdrawLog({ receiver: settlement, owner: payer, hash }), account: { address: marketWETHAddress } },
      ]),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(setExtra).toHaveBeenCalledWith("exa.ignore", true);
    expect(getSettlements).toHaveBeenCalledOnce();
    expect(getTransactionReceipt).not.toHaveBeenCalled();
    expect(getPaymentLock).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("fails withdraws when settlements fail for redelivery", async () => {
    vi.spyOn(manteca, "getSettlements").mockRejectedValueOnce(new Error("manteca down"));
    const getTransactionReceipt = vi.spyOn(publicClient, "getTransactionReceipt");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(500);
    expect(setExtra).not.toHaveBeenCalledWith("exa.ignore", true);
    expect(getTransactionReceipt).not.toHaveBeenCalled();
  });

  it("reports payments without a user operation of a known account", async () => {
    const other = padHex("0x7f", { size: 32 });
    const direct = padHex("0x7e1", { size: 32 });
    const getTransactionReceipt = vi
      .spyOn(publicClient, "getTransactionReceipt")
      .mockResolvedValueOnce(transactionReceipt(other, [operationLog({ sender: stranger, nonce })]))
      .mockResolvedValueOnce(transactionReceipt(direct, [receiptLog({ receiver: settlement, owner: payer })]));
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock");

    const response = await appClient.index.$post(
      withLogs([
        { ...payment, transaction: undefined },
        withdrawLog({ receiver: settlement, owner: stranger, hash: other }),
        withdrawLog({ receiver: settlement, owner: payer, hash: direct, assets: 1_000_000n }),
      ]),
    );

    expect(response.status).toBe(200);
    expect(getTransactionReceipt).toHaveBeenCalledTimes(2);
    expect(getTransactionReceipt).toHaveBeenCalledWith({ hash: other });
    expect(getTransactionReceipt).toHaveBeenCalledWith({ hash: direct });
    expect(getPaymentLock).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledTimes(3);
    expect(captureException).toHaveBeenCalledWith(new Error("usdc sent to settlement without qr lock"), {
      level: "error",
      contexts: { payment: { account: payer, transaction: undefined, amount: "2449218" } },
    });
    expect(captureException).toHaveBeenCalledWith(new Error("usdc sent to settlement without qr lock"), {
      level: "error",
      contexts: { payment: { account: stranger, transaction: other, amount: "2449218" } },
    });
    expect(captureException).toHaveBeenCalledWith(new Error("usdc sent to settlement without qr lock"), {
      level: "error",
      contexts: { payment: { account: payer, transaction: direct, amount: "1000000" } },
    });
  });

  it("fails a payment for redelivery", async () => {
    const error = new Error("lock lookup failed");
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockRejectedValueOnce(error);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(500);
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      contexts: { payment: { account: payer, userOpHash } },
    });
  });

  it("pays the next user operation of the bundle after a failure", async () => {
    const error = new Error("lock lookup failed");
    const next = deriveAddress(exaAccountFactoryAddress, {
      x: padHex(privateKeyToAddress(generatePrivateKey())),
      y: zeroHash,
    });
    await database.insert(credentials).values({
      id: "block-qr-next",
      publicKey: new Uint8Array(hexToBytes(next)),
      account: next,
      factory: exaAccountFactoryAddress,
    });
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
        receiptLog({ receiver: settlement, owner: next }),
        operationLog({ sender: next, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    const getPaymentLock = vi.spyOn(manteca, "getPaymentLock").mockRejectedValueOnce(error).mockResolvedValueOnce(lock);
    const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValueOnce(basicAccount);
    vi.spyOn(manteca, "getSettlement").mockResolvedValueOnce(settlement);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment").mockResolvedValueOnce(synthetic);

    const response = await appClient.index.$post(
      withLogs([payment, withdrawLog({ receiver: settlement, owner: next, hash })]),
    );

    expect(response.status).toBe(500);
    expect(getPaymentLock).toHaveBeenCalledTimes(2);
    expect(getAccount).toHaveBeenCalledExactlyOnceWith("block-qr-next", "basic");
    expect(executeQrPayment).toHaveBeenCalledExactlyOnceWith(code, userOpHash);
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      contexts: { payment: { account: payer, userOpHash } },
    });
  });

  it("reports a payment the lock rejects", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    vi.spyOn(manteca, "getPaymentLock").mockResolvedValueOnce(null);
    vi.spyOn(manteca, "getSynthetic").mockResolvedValueOnce(null);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(core.captureException).toHaveBeenCalledExactlyOnceWith(new Error("qr payment not executed"), {
      level: "error",
      contexts: { payment: { account: payer, userOpHash, amount: "2449218", cause: "expired" } },
    });
  });

  it("reports a payment with an unknown lock code", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    mockLock(Response.json({ internalStatus: "PAYMENT_LOCK_NF" }, { status: 404 }));
    const getSynthetic = vi.spyOn(manteca, "getSynthetic").mockResolvedValueOnce(null);
    const executeQrPayment = vi.spyOn(manteca, "executeQrPayment");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(200);
    expect(getSynthetic).toHaveBeenCalledExactlyOnceWith(userOpHash);
    expect(executeQrPayment).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
    expect(core.captureException).toHaveBeenCalledExactlyOnceWith(new Error("qr payment not executed"), {
      level: "error",
      contexts: { payment: { account: payer, userOpHash, amount: "2449218", cause: "lock" } },
    });
  });

  it("fails a payment for redelivery when manteca fails", async () => {
    vi.spyOn(publicClient, "getTransactionReceipt").mockResolvedValueOnce(
      transactionReceipt(hash, [
        receiptLog({ receiver: settlement, owner: payer }),
        operationLog({ sender: payer, nonce }),
      ]),
    );
    vi.spyOn(manteca, "getSettlements").mockResolvedValue({ ARS: settlement });
    mockLock(new Response("internal", { status: 500 }));
    const getSynthetic = vi.spyOn(manteca, "getSynthetic");

    const response = await appClient.index.$post(withLogs([payment]));

    expect(response.status).toBe(500);
    expect(getSynthetic).not.toHaveBeenCalled();
    expect(core.captureException).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.any(ServiceError), {
      level: "error",
      contexts: { payment: { account: payer, userOpHash } },
    });
  });

  function mockLock(response: Response) {
    const { fetch } = globalThis;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      input === `https://manteca.test/crypto/v2/payment-locks/${code}` ? Promise.resolve(response) : fetch(input, init),
    );
  }
});

const blockPayload = {
  header: {},
  json: {
    type: "GRAPHQL" as const,
    event: { data: { block: { number: 666, timestamp: Math.floor(Date.now() / 1000), logs: [] } } },
  },
};

const withdrawProposal = {
  header: {},
  json: {
    webhookId: "webhookId",
    id: "eventId",
    createdAt: "2025-02-28T20:04:49.443359731Z",
    type: "GRAPHQL" as const,
    event: {
      data: {
        block: {
          number: 24_484_514,
          timestamp: 1_740_771_568,
          logs: [{ topics: [], data: "0x", account: { address: zeroAddress } }],
        },
      },
      sequenceNumber: "10000000000578619000",
      network: "ANVIL",
    },
  },
};

function withLogs(
  logs: { account: { address: Address }; data: Hex; topics: [Hex, ...Hex[]]; transaction?: { hash: Hex } }[],
) {
  return {
    ...withdrawProposal,
    json: {
      ...withdrawProposal.json,
      event: {
        ...withdrawProposal.json.event,
        data: { ...withdrawProposal.json.event.data, block: { ...withdrawProposal.json.event.data.block, logs } },
      },
    },
  };
}

function withdrawLog({
  receiver,
  owner,
  hash,
  assets = 2_449_218n,
}: {
  assets?: bigint;
  hash?: Hex;
  owner: Address;
  receiver: Address;
}) {
  return {
    topics: encodeEventTopics({ abi: marketAbi, eventName: "Withdraw", args: { caller: owner, receiver, owner } }) as [
      Hex,
      ...Hex[],
    ],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [assets, assets]),
    account: { address: marketUSDCAddress },
    ...(hash && { transaction: { hash } }),
  };
}

function receiptLog({
  receiver,
  owner,
  assets,
  address = marketUSDCAddress,
}: {
  address?: Address;
  assets?: bigint;
  owner: Address;
  receiver: Address;
}) {
  const { topics, data } = withdrawLog({ receiver, owner, assets });
  return { address, topics, data };
}

function operationLog({
  sender,
  nonce,
  address = entryPoint06Address,
  success = true,
}: {
  address?: Address;
  nonce: bigint;
  sender: Address;
  success?: boolean;
}) {
  return {
    address,
    topics: encodeEventTopics({
      abi: entryPoint06Abi,
      eventName: "UserOperationEvent",
      args: { userOpHash: padHex("0x4337", { size: 32 }), sender, paymaster: zeroAddress },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
      [nonce, success, 0n, 0n],
    ),
  };
}

function transactionReceipt(hash: Hex, logs: ReturnType<typeof operationLog>[]): TransactionReceipt {
  return {
    blockHash: zeroHash,
    blockNumber: 1n,
    contractAddress: null,
    cumulativeGasUsed: 0n,
    effectiveGasPrice: 0n,
    from: zeroAddress,
    gasUsed: 0n,
    logs: logs.map((log, logIndex) => ({
      ...log,
      blockHash: zeroHash,
      blockNumber: 1n,
      logIndex,
      transactionHash: hash,
      transactionIndex: 0,
      removed: false,
    })),
    logsBloom: "0x",
    status: "success",
    to: entryPoint06Address,
    transactionHash: hash,
    transactionIndex: 0,
    type: "eip1559",
  };
}

const withdrawTopic = toEventSelector(getAbiItem({ abi: marketAbi, name: "Withdraw" }));

const basicAccount = {
  id: "act_qr",
  type: "account" as const,
  attributes: {
    "country-code": "AR",
    "email-address": "jane@example.com",
    "name-first": "Jane",
    "name-middle": null,
    "name-last": "Doe",
    "address-street-1": "123 Main St",
    "address-street-2": null,
    "address-city": "Buenos Aires",
    "address-subdivision": "CABA", // cspell:ignore CABA
    "address-postal-code": "1000",
    "social-security-number": null,
    "phone-number": "+5491123456789",
    birthdate: "1990-01-01",
    fields: {
      name: { value: { first: { value: "Jane" }, middle: { value: null }, last: { value: "Doe" } } },
      address: {
        value: {
          street_1: { value: "123 Main St" },
          street_2: { value: null },
          city: { value: "Buenos Aires" },
          subdivision: { value: "CABA" },
          postal_code: { value: "1000" },
          country_code: { value: "AR" },
        },
      },
      birthdate: { value: "1990-01-01" },
      phone_number: { value: "+5491123456789" },
      email_address: { value: "jane@example.com" },
      selfie_photo: { value: { filename: "selfie.jpg", url: "https://example.com/selfie.jpg" } },
      rain_e_sign_consent: { value: true },
      exa_card_tc: { value: true },
      privacy__policy: { value: true },
      account_opening_disclosure: { value: null },
      economic_activity: { value: "Developer" },
      annual_salary: { value: "50000" },
      expected_monthly_volume: { value: "1000" },
      accurate_info_confirmation: { value: true },
      non_unauthorized_solicitation: { value: true },
      non_illegal_activities_2: { value: "No" as const },
      documents: {
        value: [
          {
            value: {
              id_class: { value: "id" },
              id_number: { value: "30123456" },
              id_issuing_country: { value: "AR" },
              id_document_id: { value: "doc_id" },
            },
          },
        ],
      },
    },
  },
};

const passportAccount = {
  ...basicAccount,
  attributes: {
    ...basicAccount.attributes,
    fields: {
      ...basicAccount.attributes.fields,
      documents: {
        value: [
          {
            value: {
              id_class: { value: "pp" },
              id_number: { value: "AAA123456" },
              id_issuing_country: { value: "AR" },
              id_document_id: { value: "doc_pp" },
            },
          },
        ],
      },
    },
  },
};

afterEach(() => vi.restoreAllMocks());

vi.mock("@sentry/core", { spy: true });
vi.mock("@sentry/node", { spy: true });

const legacyFactory = getAddress("0x8D493AF799162Ac3f273e8918B2842447f702163");
const legacyFactoryPlugin = getAddress("0xBeE265c71EDdaEfa035b6966D8f744261E5dd182");
const legacyPlugins = [
  getAddress("0x2Bbaf52f13513CE325066D387c1dA1F260c26887"),
  getAddress("0x87aF7e4892e47a7De34dF689bA5f3bCccED3e5DE"),
] as const;

function spyAdd() {
  const add = vi.spyOn(Queue.prototype, "add");
  return (account: Address, kind?: "proposal" | "withdraw") =>
    add.mock.calls.flatMap(([, data, options]) => {
      const job = data as Job;
      return job.account === account && (kind === undefined || "nonce" in job === (kind === "proposal"))
        ? [{ ...job, jobId: options?.jobId }]
        : [];
    });
}

function post(logs: Parameters<typeof blockPayloadWith>[0]) {
  return appClient.index.$post(blockPayloadWith(logs));
}

function blockPayloadWith(logs: { account: { address: Address }; data: Hex; topics: [Hex, ...Hex[]] }[]) {
  return {
    ...withdrawProposal,
    json: {
      ...withdrawProposal.json,
      event: {
        ...withdrawProposal.json.event,
        data: { ...withdrawProposal.json.event.data, block: { ...withdrawProposal.json.event.data.block, logs } },
      },
    },
  };
}

function spySetAttribute() {
  const setAttribute = vi.fn();
  vi.mocked(getActiveSpan).mockReturnValue({ setAttribute } as unknown as ReturnType<typeof getActiveSpan>);
  onTestFinished(() => {
    vi.mocked(getActiveSpan).mockReset();
  });
  return setAttribute;
}

function capturedFor(account: Address) {
  return vi.mocked(captureException).mock.calls.filter((call) => inspect(call, { depth: Infinity }).includes(account));
}
