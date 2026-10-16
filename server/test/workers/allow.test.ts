import "../mocks/sentry";
import "../mocks/wallet";

import { KeyManagementServiceClient } from "@google-cloud/kms";
import { captureException, continueTrace, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents, type Job, type JobsOptions } from "bullmq";
import { eq, inArray } from "drizzle-orm";
import { parse } from "valibot";
import {
  concatHex,
  ContractFunctionRevertedError,
  createTestClient,
  encodeErrorResult,
  ExecutionRevertedError,
  http,
  HttpRequestError,
  InternalRpcError,
  keccak256,
  padHex,
  publicActions,
  toHex,
  walletActions,
  zeroAddress,
} from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { moonbeamDev } from "viem/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import chain, {
  auditorAbi,
  auditors,
  exaAccountFactoryAddress,
  firewallAbi,
  simple7702AccountAddress,
} from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { credentials, organizations } from "../../database";
import { NETWORKS } from "../../utils/alchemy";
import { bullmq } from "../../utils/redis";
import wallet, { signer } from "../../utils/wallet";
import createAllow from "../../workers/allow/queue";
import allowWorker from "../../workers/allow/worker";
import { finished, tip } from "../redis";

import type { Job as Allow, Batch } from "../../workers/allow/job";
import type createPoke from "../../workers/poke/queue";
import type * as sentry from "@sentry/node";

const anvil = NETWORKS.get("ANVIL");
const anvil2 = NETWORKS.get("ANVIL2");
if (!anvil || !anvil2) throw new Error("missing local networks");
const anvil2Client = createTestClient({ chain: anvil2, mode: "anvil", transport: http() })
  .extend(publicActions)
  .extend(walletActions);
const firewall = await anvil2Client.readContract({
  address: parse(Address, auditors.get(moonbeamDev.id)),
  functionName: "firewall",
  abi: auditorAbi,
});
const kms = new KeyManagementServiceClient();
const allower = await signer("allower", kms);
const factory = parse(Address, exaAccountFactoryAddress);
const account = parse(Address, padHex("0xb0b", { size: 20 }));
const salt = parse(Address, padHex("0x0", { size: 20 }));
const request = { account, chainId: chain.id, factory, publicKey: "0x1234" as const, salt, source: null };
const allow = createAllow(bullmq);
const mocks = vi.hoisted(() => ({
  closePoke: vi.fn<ReturnType<typeof createPoke>["close"]>(),
  createPoke: vi.fn<typeof createPoke>(),
  enqueuePoke: vi.fn<ReturnType<typeof createPoke>["enqueue"]>(),
}));

vi.mock("../../workers/poke/queue", () => ({ default: mocks.createPoke }));

const queue = new Queue<Allow | Batch, void, "allow">("allow", { connection: bullmq });
const events = new QueueEvents("allow", { connection: bullmq, lastEventId: await tip(bullmq, queue) });
let worker: Awaited<ReturnType<typeof allowWorker>>;

async function jobFinished(current: Address, options?: JobsOptions, data?: Partial<Allow>) {
  const result = finished(events, current);
  const job = await queue.add(
    "allow",
    { ...request, account: current, ...data },
    { attempts: 1, jobId: current, removeOnComplete: true, removeOnFail: true, ...options },
  );
  await result.catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
  return job;
}

async function batchFinished(accounts: Address[], chainId: number = moonbeamDev.id) {
  const result = finished(events, "batch");
  await queue.add(
    "allow",
    { accounts: accounts.map((current) => ({ ...request, account: current, chainId: undefined })), chainId },
    { attempts: 1, jobId: "batch", removeOnComplete: true, removeOnFail: true },
  );
  await result.catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
}

function random() {
  return parse(Address, privateKeyToAddress(generatePrivateKey()));
}

function allowlist(current: Address) {
  return anvil2Client.readContract({ address: firewall, functionName: "allowlist", args: [current], abi: firewallAbi });
}

async function allowed(fromBlock: bigint) {
  const logs = await anvil2Client.getContractEvents({
    address: firewall,
    abi: firewallAbi,
    eventName: "Allowed",
    args: { allower: allower.address },
    fromBlock,
  });
  return logs.map(({ args }) => args.account);
}

async function allowOnChain(current: Address) {
  await anvil2Client.waitForTransactionReceipt({
    hash: await anvil2Client.writeContract({
      account: allower,
      address: firewall,
      functionName: "allow",
      args: [current, true],
      abi: firewallAbi,
    }),
  });
}

async function setRole(functionName: "grantRole" | "revokeRole") {
  await anvil2Client.waitForTransactionReceipt({
    hash: await anvil2Client.writeContract({
      account: null,
      address: firewall,
      functionName,
      args: [keccak256(toHex("ALLOWER_ROLE")), allower.address],
      abi: firewallAbi,
    }),
  });
}

function spyWallet(...spies: ((client: ReturnType<typeof wallet>) => unknown)[]) {
  const create = vi.mocked(wallet).getMockImplementation();
  if (!create) throw new Error("missing wallet");
  for (const spy of spies) {
    vi.mocked(wallet).mockImplementationOnce((...parameters) => {
      const client = create(...parameters);
      spy(client);
      return client;
    });
  }
}

async function idle() {
  await vi.waitUntil(
    async () =>
      Object.values(await queue.getJobCounts("active", "delayed", "prioritized", "waiting")).every(
        (count) => count === 0,
      ),
    { timeout: 20_000 },
  );
}

function backfilled(addBulk: MockInstance<Queue["addBulk"]>) {
  return addBulk.mock.calls.flatMap(([jobs]) => jobs as { data: Batch; opts: JobsOptions }[]);
}

async function spyScopeSetUser() {
  const { withScope: realWithScope } = await vi.importActual<typeof sentry>("@sentry/node");
  const setUser = vi.fn();
  vi.mocked(withScope).mockImplementation((_scopeOrCallback, _callback?) =>
    realWithScope((scope) => {
      const originalSetUser = scope.setUser.bind(scope);
      scope.setUser = (...args: Parameters<typeof scope.setUser>) => {
        setUser(...args);
        return originalSetUser(...args);
      };
      return ((_callback ?? _scopeOrCallback) as NonNullable<typeof _callback>)(scope);
    }),
  );
  return setUser;
}

afterAll(async () => {
  await Promise.all([events.close(), queue.close(), allow.close(), kms.close()]);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  mocks.closePoke.mockReset().mockResolvedValue();
  mocks.createPoke.mockReset().mockReturnValue({ close: mocks.closePoke, enqueue: mocks.enqueuePoke });
  mocks.enqueuePoke.mockReset().mockResolvedValue();
  vi.clearAllMocks();
  await queue.drain(true);
  await queue.clean(0, 1000, "completed");
  await queue.clean(0, 1000, "failed");
});

describe("allow queue", () => {
  it("publishes firewall allow jobs", async () => {
    await expect(allow.enqueue(request)).resolves.toBeUndefined();

    const job = await queue.getJob(`${chain.id}-${account}`);
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(`${chain.id}-${account}`);
    expect(job.name).toBe("allow");
    expect(job.data).toStrictEqual({
      ...request,
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(job.opts).toStrictEqual({
      attempts: 10,
      backoff: { type: "exponential", delay: 1000 },
      jobId: `${chain.id}-${account}`,
      removeOnComplete: true,
      removeOnFail: true,
    });
    await expect(job.getState()).resolves.toBe("waiting");
    expect(startSpan).toHaveBeenCalledWith(
      { name: "allow", op: "queue.publish", attributes: { "messaging.destination.name": "allow" } },
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
    await job.remove();
  });

  it("publishes prioritized backfill batches in bulk", async () => {
    const accounts = Array.from({ length: 101 }, (_, index) => ({
      account: parse(Address, padHex(toHex(index + 1), { size: 20 })),
      factory,
      publicKey: "0x1234" as const,
      salt,
      source: index === 0 ? "client" : null,
    }));

    await expect(allow.backfill(moonbeamDev.id, accounts)).resolves.toBeUndefined();

    for (const chunk of [accounts.slice(0, 100), accounts.slice(100)]) {
      const id = `${moonbeamDev.id}-${keccak256(concatHex(chunk.map(({ account: current }) => current)))}`;
      const job = await queue.getJob(id);
      if (!job) throw new Error("job not found");
      expect(job.name).toBe("allow");
      expect(job.data).toStrictEqual({
        accounts: chunk,
        chainId: moonbeamDev.id,
        sentryBaggage: expect.any(String) as string,
        sentryTrace: expect.any(String) as string,
      });
      expect(job.opts).toStrictEqual({
        attempts: 10,
        backoff: { type: "exponential", delay: 1000 },
        jobId: id,
        priority: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
      await expect(job.getState()).resolves.toBe("prioritized");
      await job.remove();
    }
    expect(startSpan).toHaveBeenCalledWith(
      {
        name: "allow",
        op: "queue.publish",
        attributes: { "messaging.destination.name": "allow", "messaging.batch.message_count": 2 },
      },
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("propagates queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await expect(allow.enqueue(request)).rejects.toThrow(error);

    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("allow backfill", () => {
  const persona = parse(Address, padHex("0xa11ce", { size: 20 }));
  const sourced = parse(Address, padHex("0x50c", { size: 20 }));
  const done = parse(Address, padHex("0xa110", { size: 20 }));
  const partner = parse(Address, padHex("0xb12", { size: 20 }));
  const pending = parse(Address, padHex("0xc0de", { size: 20 }));
  const accounts = [persona, sourced, done, partner, pending];

  beforeAll(async () => {
    await allowOnChain(done);
    await database
      .insert(organizations)
      .values({ id: "allow-partner", name: "partner", slug: "allow-partner", createdAt: new Date(), role: "kyc" });
    await database.insert(credentials).values(
      accounts.map((current) => ({
        id: `allow-${current}`,
        account: current,
        factory,
        publicKey: new Uint8Array(),
        pandaId: current === pending ? null : `panda-${current}`,
        source: current === partner ? "allow-partner" : current === sourced ? "allow-client" : null,
      })),
    );
  });

  afterAll(async () => {
    await database.delete(credentials).where(
      inArray(
        credentials.id,
        accounts.map((current) => `allow-${current}`),
      ),
    );
    await database.delete(organizations).where(eq(organizations.id, "allow-partner"));
  });

  afterEach(async () => {
    await worker.close();
  });

  it("allows persona-approved accounts on chains with a firewall", async () => {
    const addBulk = vi.spyOn(Queue.prototype, "addBulk");

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;
    await idle();

    await expect(Promise.all(accounts.map((current) => allowlist(current)))).resolves.toStrictEqual([
      allower.address,
      allower.address,
      allower.address,
      zeroAddress,
      zeroAddress,
    ]);
    await expect(anvil2Client.getDelegation({ address: allower.address })).resolves.toBe(simple7702AccountAddress);
    const jobs = backfilled(addBulk);
    expect(jobs.map(({ data }) => data.chainId)).toStrictEqual(jobs.map(() => moonbeamDev.id));
    expect(jobs.map(({ opts }) => opts.priority)).toStrictEqual(jobs.map(() => 1));
    const batched = jobs.flatMap(({ data }) => data.accounts);
    expect(batched).toStrictEqual(
      expect.arrayContaining([
        { account: persona, factory, publicKey: "0x", salt, source: null },
        { account: sourced, factory, publicKey: "0x", salt, source: "allow-client" },
      ]),
    );
    expect(batched.filter(({ account: current }) => [done, partner, pending].includes(current))).toStrictEqual([]);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("publishes nothing for accounts already allowed", async () => {
    const addBulk = vi.spyOn(Queue.prototype, "addBulk");

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;

    expect(
      backfilled(addBulk)
        .flatMap(({ data }) => data.accounts)
        .filter(({ account: current }) => accounts.includes(current)),
    ).toStrictEqual([]);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips chains where the allower has no funds", async () => {
    const addBulk = vi.spyOn(Queue.prototype, "addBulk");
    await anvil2Client.setBalance({ address: allower.address, value: 0n });

    try {
      worker = allowWorker({ allower, bullmq, database });
      await worker.ready;
    } finally {
      await anvil2Client.setBalance({ address: allower.address, value: 10n ** 24n });
    }

    expect(addBulk).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("allower not ready"), {
      level: "warning",
      tags: { queue: "allow", chainId: moonbeamDev.id },
      extra: { role: true, balance: 0n },
    });
  });

  it("skips chains where the allower has no role", async () => {
    const addBulk = vi.spyOn(Queue.prototype, "addBulk");
    await setRole("revokeRole");

    try {
      worker = allowWorker({ allower, bullmq, database });
      await worker.ready;
    } finally {
      await setRole("grantRole");
    }

    expect(addBulk).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("allower not ready"), {
      level: "warning",
      tags: { queue: "allow", chainId: moonbeamDev.id },
      extra: { role: false, balance: await anvil2Client.getBalance({ address: allower.address }) },
    });
  });

  it("captures chain failures without stopping other chains", async () => {
    const unavailable = new HttpRequestError({ url: "https://rpc.test" });
    let reads: MockInstance | undefined;
    spyWallet(
      (client) => vi.spyOn(client, "readContract").mockRejectedValue(unavailable),
      (client) => (reads = vi.spyOn(client, "readContract")),
    );

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;

    expect(wallet).toHaveBeenCalledWith(allower, anvil);
    expect(wallet).toHaveBeenCalledWith(allower, anvil2);
    expect(reads).toHaveBeenCalledWith(expect.objectContaining({ functionName: "hasRole" }));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(unavailable, {
      level: "error",
      tags: { queue: "allow", chainId: chain.id },
    });
  });

  it("captures database failures without failing", async () => {
    const error = new Error("database unavailable");
    vi.spyOn(database, "select").mockReturnValueOnce({
      from: () => ({ where: () => Promise.reject(error) }),
    } as unknown as ReturnType<typeof database.select>);

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;

    expect(wallet).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error", tags: { queue: "allow" } });
  });
});

describe("allow worker", () => {
  beforeEach(async () => {
    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;
    await idle();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await worker.close();
  });

  it("skips chains without a firewall", async () => {
    await jobFinished(account);

    expect(wallet).toHaveBeenCalledExactlyOnceWith(allower, anvil);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("allows other chains without poking", async () => {
    const current = random();

    await jobFinished(current, undefined, { chainId: moonbeamDev.id });

    await expect(allowlist(current)).resolves.toBe(allower.address);
    expect(wallet).toHaveBeenCalledExactlyOnceWith(allower, anvil2);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(startSpan).toHaveBeenCalledWith(
      {
        forceTransaction: true,
        name: "firewall.allow",
        op: "exa.firewall",
        attributes: { account: current, chainId: moonbeamDev.id },
      },
      expect.any(Function),
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ forceTransaction: true, name: "allow worker" }),
      expect.any(Function),
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "allow", op: "queue.process" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("ignores accounts already allowed", async () => {
    const current = random();
    await allowOnChain(current);

    await jobFinished(current, undefined, { chainId: moonbeamDev.id });

    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("allows batches through the delegated allower", async () => {
    const [current, done, other] = [random(), random(), random()];
    await allowOnChain(done);
    await anvil2Client.setCode({ address: allower.address, bytecode: "0x" });
    const fromBlock = (await anvil2Client.getBlockNumber({ cacheTime: 0 })) + 1n;

    await batchFinished([current, done, other]);

    await expect(anvil2Client.getDelegation({ address: allower.address })).resolves.toBe(simple7702AccountAddress);
    await expect(allowed(fromBlock)).resolves.toStrictEqual([current, other]);
    expect(wallet).toHaveBeenCalledExactlyOnceWith(allower, anvil2);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("keeps an existing allower delegation", async () => {
    const current = random();
    await anvil2Client.setCode({
      address: allower.address,
      bytecode: concatHex(["0xef0100", simple7702AccountAddress]),
    });
    const nonce = await anvil2Client.getTransactionCount({ address: allower.address });

    await batchFinished([current]);

    await expect(anvil2Client.getTransactionCount({ address: allower.address })).resolves.toBe(nonce + 1);
    await expect(allowlist(current)).resolves.toBe(allower.address);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips batches already allowed", async () => {
    const current = random();
    await allowOnChain(current);
    const nonce = await anvil2Client.getTransactionCount({ address: allower.address });

    await batchFinished([current]);

    await expect(anvil2Client.getTransactionCount({ address: allower.address })).resolves.toBe(nonce);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips batches on chains without a firewall", async () => {
    await batchFinished([random()], chain.id);

    expect(wallet).toHaveBeenCalledExactlyOnceWith(allower, anvil);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures batch failures without a user", async () => {
    const current = random();
    const setUser = await spyScopeSetUser();
    await setRole("revokeRole");

    try {
      await expect(batchFinished([current])).rejects.toThrow("is missing role");
    } finally {
      await setRole("grantRole");
    }

    await expect(allowlist(current)).resolves.toBe(zeroAddress);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledTimes(2);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ shortMessage: expect.any(String) as string }),
      {
        extra: { account: undefined, attempts: 1, id: "batch" },
        level: "error",
        tags: { queue: "allow", job: "allow", chainId: moonbeamDev.id },
      },
    );
  });

  it("fails on unsupported chains", async () => {
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account, undefined, { chainId: 0 })).rejects.toThrow("unsupported chain 0");

    expect(wallet).not.toHaveBeenCalled();
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("unsupported chain 0"), {
      extra: { account, attempts: 1, id: account },
      level: "error",
      tags: { queue: "allow", job: "allow", chainId: 0 },
    });
  });

  it("captures terminal failures", async () => {
    const current = random();
    const setUser = await spyScopeSetUser();
    await setRole("revokeRole");

    try {
      await expect(
        jobFinished(
          current,
          { attempts: 2, backoff: { type: "fixed", delay: 1 }, removeOnFail: false },
          { chainId: moonbeamDev.id },
        ),
      ).rejects.toThrow("is missing role");
    } finally {
      await setRole("grantRole");
    }

    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState(current)).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(current);
    expect(job.failedReason).toContain("is missing role");
    expect(job.attemptsMade).toBe(2);
    expect(job.stacktrace).toHaveLength(2);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith({ id: current });
    expect(captureException).toHaveBeenCalledTimes(3);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ shortMessage: expect.any(String) as string }),
      {
        extra: { account: current, attempts: 2, id: current },
        level: "error",
        tags: { queue: "allow", job: "allow", chainId: moonbeamDev.id },
      },
    );
    await job.remove();
  });

  it.each([
    ["contract", new ContractFunctionRevertedError({ abi: auditorAbi, functionName: "firewall" })],
    ["empty", new ContractFunctionRevertedError({ abi: auditorAbi, data: "0x", functionName: "firewall" })],
    ["node", new ExecutionRevertedError()],
  ])("skips chains whose auditor reverts on firewall with %s errors", async (_, error) => {
    spyWallet((client) => vi.spyOn(client, "readContract").mockRejectedValue(error));

    await jobFinished(account, undefined, { chainId: moonbeamDev.id });

    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips chains whose auditor has no firewall set", async () => {
    spyWallet((client) => vi.spyOn(client, "readContract").mockResolvedValue(zeroAddress));

    await jobFinished(account, undefined, { chainId: moonbeamDev.id });

    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each([
    ["unknown", new Error("rpc unavailable")],
    ["viem", new HttpRequestError({ url: "https://rpc.test" })],
    [
      "internal",
      new ContractFunctionRevertedError({
        abi: auditorAbi,
        functionName: "firewall",
        message: "internal error",
        cause: new InternalRpcError(new Error("internal error")),
      }),
    ],
    [
      "data",
      new ContractFunctionRevertedError({
        abi: auditorAbi,
        functionName: "firewall",
        data: encodeErrorResult({ abi: auditorAbi, errorName: "InvalidOperation" }),
      }),
    ],
  ])("fails when the firewall lookup throws %s errors", async (_, error) => {
    const setUser = await spyScopeSetUser();
    spyWallet((client) => vi.spyOn(client, "readContract").mockRejectedValue(error));

    await expect(jobFinished(account, undefined, { chainId: moonbeamDev.id })).rejects.toThrow(error.message);

    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: error.message }), {
      extra: { account, attempts: 1, id: account },
      level: "error",
      tags: { queue: "allow", job: "allow", chainId: moonbeamDev.id },
    });
  });

  it("continues sentry traces", async () => {
    await jobFinished(account, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(continueTrace).toHaveBeenCalledWith({ sentryTrace: "trace", baggage: "baggage" }, expect.any(Function));
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.queue.emit("error", error);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error", tags: { queue: "allow" } });
  });

  it("captures failed events without a job", async () => {
    const error = new Error("failed event error");
    const setUser = await spyScopeSetUser();

    worker.queue.emit("failed", undefined, error, "active");

    expect(setUser).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account: undefined, attempts: undefined, id: undefined },
      level: "error",
      tags: { queue: "allow", job: undefined, chainId: undefined },
    });
  });

  it("skips intermediate failed events with default attempts", () => {
    const error = new Error("failed event error");

    worker.queue.emit(
      "failed",
      { attemptsMade: 9, data: { account }, name: "allow", opts: {} } as Job,
      error,
      "active",
    );

    expect(captureException).not.toHaveBeenCalled();
  });
});
