import "../mocks/sentry";

import { captureException, continueTrace, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents, type Job, type JobsOptions } from "bullmq";
import { eq, inArray } from "drizzle-orm";
import { parse } from "valibot";
import {
  concatHex,
  ContractFunctionRevertedError,
  encodeErrorResult,
  encodeFunctionData,
  ExecutionRevertedError,
  HttpRequestError,
  InternalRpcError,
  keccak256,
  padHex,
  parseAbi,
  toHex,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import chain, {
  auditorAbi,
  auditorAddress,
  auditors,
  exaAccountFactoryAddress,
  firewallAbi,
  simple7702AccountAddress,
} from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { credentials, organizations } from "../../database";
import { NETWORKS } from "../../utils/alchemy";
import { bullmq } from "../../utils/redis";
import createAllow from "../../workers/allow/queue";
import allowWorker from "../../workers/allow/worker";

import type { Job as Allow, Batch } from "../../workers/allow/job";
import type createPoke from "../../workers/poke/queue";
import type * as sentry from "@sentry/node";

const factory = parse(Address, exaAccountFactoryAddress);
const account = parse(Address, padHex("0xb0b", { size: 20 }));
const firewall = parse(Address, padHex("0xf12e", { size: 20 }));
const request = { account, chainId: chain.id, factory, publicKey: "0x1234" as const, source: null };
const allower = privateKeyToAccount(padHex("0xa11"));
const authorization = { address: simple7702AccountAddress, chainId: chain.id, nonce: 1 };
const hash = padHex("0x7702", { size: 32 });
const allow = createAllow(bullmq);
const mocks = vi.hoisted(() => ({
  closePoke: vi.fn<ReturnType<typeof createPoke>["close"]>(),
  createPoke: vi.fn<typeof createPoke>(),
  enqueuePoke: vi.fn<ReturnType<typeof createPoke>["enqueue"]>(),
  exaSend: vi.fn(),
  getBalance: vi.fn<() => Promise<bigint>>(),
  getDelegation: vi.fn<() => Promise<`0x${string}` | undefined>>(),
  multicall:
    vi.fn<
      (parameters: {
        batchSize: number;
        contracts: readonly { args: readonly [Address] }[];
        deployless: boolean;
      }) => Promise<{ result?: boolean; status: "failure" | "success" }[]>
    >(),
  readContract: vi.fn<(parameters: { functionName: string }) => Promise<unknown>>(),
  sendTransaction: vi.fn<() => Promise<`0x${string}`>>(),
  signAuthorization: vi.fn<() => Promise<typeof authorization>>(),
  waitForTransactionReceipt: vi.fn<() => Promise<object>>(),
  wallet: vi.fn(),
}));
const client = {
  exaSend: mocks.exaSend,
  getBalance: mocks.getBalance,
  getDelegation: mocks.getDelegation,
  multicall: mocks.multicall,
  readContract: mocks.readContract,
  sendTransaction: mocks.sendTransaction,
  signAuthorization: mocks.signAuthorization,
  waitForTransactionReceipt: mocks.waitForTransactionReceipt,
};

vi.mock("../../utils/wallet", () => ({ default: mocks.wallet }));
vi.mock("../../workers/poke/queue", () => ({ default: mocks.createPoke }));

const queue = new Queue<Allow | Batch, void, "allow">("allow", { connection: bullmq });
const events = new QueueEvents("allow", { connection: bullmq });
let worker: Awaited<ReturnType<typeof allowWorker>>;

async function jobFinished(current: Address, options?: JobsOptions, data?: Partial<Allow>) {
  const job = await queue.add(
    "allow",
    { ...request, account: current, ...data },
    { attempts: 1, jobId: current, removeOnComplete: true, removeOnFail: true, ...options },
  );
  await job.waitUntilFinished(events).catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
  return job;
}

async function batchFinished(accounts: Address[], chainId: number = chain.id) {
  const job = await queue.add(
    "allow",
    { accounts: accounts.map((current) => ({ ...request, account: current, chainId: undefined })), chainId },
    { attempts: 1, jobId: "batch", removeOnComplete: true, removeOnFail: true },
  );
  await job.waitUntilFinished(events).catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
}

function batch(target: Address, accounts: Address[]) {
  return {
    address: allower.address,
    functionName: "executeBatch",
    args: [
      accounts.map((current) => ({
        target,
        value: 0n,
        data: encodeFunctionData({ abi: firewallAbi, functionName: "allow", args: [current, true] }),
      })),
    ],
    abi: [
      ...firewallAbi,
      ...parseAbi([
        "function executeBatch((address target, uint256 value, bytes data)[] calls)",
        "error ExecuteError(uint256 index, bytes revertData)",
      ]),
    ],
  };
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
  await Promise.all([events.close(), queue.close(), allow.close()]);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  mocks.closePoke.mockReset().mockResolvedValue();
  mocks.createPoke.mockReset().mockReturnValue({ close: mocks.closePoke, enqueue: mocks.enqueuePoke });
  mocks.enqueuePoke.mockReset().mockResolvedValue();
  mocks.exaSend.mockReset().mockResolvedValue({});
  mocks.getBalance.mockReset().mockResolvedValue(1n);
  mocks.getDelegation.mockReset().mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- no delegation
  mocks.multicall
    .mockReset()
    .mockImplementation(({ contracts }) =>
      Promise.resolve(contracts.map(() => ({ result: true, status: "success" as const }))),
    );
  mocks.readContract
    .mockReset()
    .mockImplementation(({ functionName }) => Promise.resolve(functionName === "firewall" ? firewall : true));
  mocks.sendTransaction.mockReset().mockResolvedValue(hash);
  mocks.signAuthorization.mockReset().mockResolvedValue(authorization);
  mocks.waitForTransactionReceipt.mockReset().mockResolvedValue({});
  mocks.wallet.mockReset().mockReturnValue(client);
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
      source: index === 0 ? "client" : null,
    }));

    await expect(allow.backfill(baseSepolia.id, accounts, 2)).resolves.toBeUndefined();

    for (const chunk of [accounts.slice(0, 100), accounts.slice(100)]) {
      const id = `${baseSepolia.id}-${keccak256(concatHex(chunk.map(({ account: current }) => current)))}`;
      const job = await queue.getJob(id);
      if (!job) throw new Error("job not found");
      expect(job.name).toBe("allow");
      expect(job.data).toStrictEqual({
        accounts: chunk,
        chainId: baseSepolia.id,
        sentryBaggage: expect.any(String) as string,
        sentryTrace: expect.any(String) as string,
      });
      expect(job.opts).toStrictEqual({
        attempts: 10,
        backoff: { type: "exponential", delay: 1000 },
        jobId: id,
        priority: 2,
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
  const allowed = parse(Address, padHex("0xa110", { size: 20 }));
  const partner = parse(Address, padHex("0xb12", { size: 20 }));
  const pending = parse(Address, padHex("0xc0de", { size: 20 }));
  const accounts = [persona, sourced, allowed, partner, pending, "bad"];

  beforeAll(async () => {
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

  it("allows persona-approved accounts on chains with a ready firewall", async () => {
    const addBulk = vi.spyOn(Queue.prototype, "addBulk");
    const unavailable = new HttpRequestError({ url: "https://rpc.test" });
    mocks.multicall.mockImplementation(({ contracts }) =>
      Promise.resolve(
        contracts.map(({ args: [current] }) =>
          current === sourced
            ? { status: "failure" as const }
            : { result: current !== persona, status: "success" as const },
        ),
      ),
    );
    mocks.wallet.mockImplementation((_, network: { id: number }) => ({
      ...client,
      readContract:
        network.id === chain.id
          ? mocks.readContract
          : () => Promise.reject(network.id === baseSepolia.id ? unavailable : new ExecutionRevertedError()),
    }));

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;
    await vi.waitUntil(() => mocks.enqueuePoke.mock.calls.length === 2);

    expect(mocks.readContract).toHaveBeenCalledWith({
      address: auditorAddress,
      functionName: "firewall",
      abi: auditorAbi,
    });
    expect(mocks.readContract).toHaveBeenCalledWith({
      address: firewall,
      functionName: "hasRole",
      args: [keccak256(toHex("ALLOWER_ROLE")), allower.address],
      abi: firewallAbi,
    });
    expect(mocks.getBalance).toHaveBeenCalledExactlyOnceWith({ address: allower.address });
    expect(mocks.multicall).toHaveBeenCalledTimes(2);
    expect(mocks.multicall).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        batchSize: 65_536,
        contracts: [persona, sourced].map((current) => ({
          address: firewall,
          functionName: "isAllowed",
          args: [current],
          abi: firewallAbi,
        })),
        deployless: true,
      }),
    );
    const checked = mocks.multicall.mock.calls[0]?.[0].contracts.map(({ args: [current] }) => current);
    expect(checked).toStrictEqual(expect.arrayContaining([persona, sourced, allowed]));
    expect(checked).not.toContain(partner);
    expect(checked).not.toContain(pending);
    expect(checked).not.toContain("bad");
    expect(addBulk).toHaveBeenCalledExactlyOnceWith([
      {
        name: "allow",
        data: expect.objectContaining({
          accounts: [
            { account: persona, factory, publicKey: "0x", source: null },
            { account: sourced, factory, publicKey: "0x", source: "allow-client" },
          ],
          chainId: chain.id,
        }) as object,
        opts: { jobId: `${chain.id}-${keccak256(concatHex([persona, sourced]))}`, priority: 1 },
      },
    ]);
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "firewall.allow", op: "exa.firewall", attributes: { accounts: 2, chainId: chain.id } },
      batch(firewall, [persona, sourced]),
      {},
    );
    for (const [current, source] of [
      [persona, null],
      [sourced, "allow-client"],
    ] as const) {
      expect(mocks.enqueuePoke).toHaveBeenCalledWith({
        account: current,
        chainId: chain.id,
        factory,
        origin: "allow",
        publicKey: "0x",
        source,
      });
    }
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(unavailable, {
      level: "error",
      tags: { queue: "allow", chainId: baseSepolia.id },
    });
  });

  it("skips chains where the allower is not ready", async () => {
    mocks.wallet.mockImplementation((_, network: { id: number }) => ({
      ...client,
      getBalance: () => Promise.resolve(network.id === chain.id ? 0n : 1n),
      readContract: ({ functionName }: { functionName: string }) =>
        Promise.resolve(functionName === "firewall" ? firewall : network.id === chain.id),
    }));

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;

    expect(mocks.multicall).not.toHaveBeenCalled();
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledTimes(auditors.size);
    for (const chainId of auditors.keys()) {
      expect(vi.mocked(captureException)).toHaveBeenCalledWith(new Error("allower not ready"), {
        level: "warning",
        tags: { queue: "allow", chainId },
        extra: chainId === chain.id ? { role: true, balance: 0n } : { role: false, balance: 1n },
      });
    }
  });

  it("publishes nothing when every account is already allowed", async () => {
    const addBulk = vi.spyOn(Queue.prototype, "addBulk");
    vi.spyOn(database, "select").mockReturnValueOnce({
      from: () => ({ where: () => Promise.resolve([]) }),
    } as unknown as ReturnType<typeof database.select>);

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;

    expect(mocks.multicall).toHaveBeenCalledTimes(auditors.size);
    expect(mocks.multicall).toHaveBeenCalledWith(expect.objectContaining({ contracts: [] }));
    expect(addBulk).not.toHaveBeenCalled();
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("captures database failures without failing", async () => {
    const error = new Error("database unavailable");
    vi.spyOn(database, "select").mockReturnValueOnce({
      from: () => ({ where: () => Promise.reject(error) }),
    } as unknown as ReturnType<typeof database.select>);

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;

    expect(mocks.wallet).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "allow" },
    });
  });
});

describe("allow worker", () => {
  beforeEach(async () => {
    mocks.getBalance.mockResolvedValue(0n);
    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await worker.close();
  });

  it("allows queued accounts with the isolated wallet", async () => {
    await jobFinished(account);

    expect(mocks.wallet).toHaveBeenCalledExactlyOnceWith(
      allower,
      [...NETWORKS.values()].find(({ id }) => id === chain.id),
    );
    expect(mocks.readContract).toHaveBeenCalledExactlyOnceWith({
      address: auditorAddress,
      functionName: "firewall",
      abi: auditorAbi,
    });
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "firewall.allow", op: "exa.firewall", attributes: { account, chainId: chain.id } },
      { address: firewall, functionName: "allow", args: [account, true], abi: firewallAbi },
      { ignore: [`AlreadyAllowed(${account})`] },
    );
    expect(mocks.enqueuePoke).toHaveBeenCalledExactlyOnceWith({ ...request, origin: "allow" });
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ forceTransaction: true, name: "allow worker" }),
      expect.any(Function),
    );
    expect(vi.mocked(startSpan)).toHaveBeenCalledWith(
      expect.objectContaining({ name: "allow", op: "queue.process" }),
      expect.any(Function),
    );
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("allows other chains without poking", async () => {
    await jobFinished(account, undefined, { chainId: baseSepolia.id });

    expect(mocks.wallet).toHaveBeenCalledExactlyOnceWith(allower, NETWORKS.get("BASE_SEPOLIA"));
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "firewall.allow", op: "exa.firewall", attributes: { account, chainId: baseSepolia.id } },
      { address: firewall, functionName: "allow", args: [account, true], abi: firewallAbi },
      { fees: "auto", ignore: [`AlreadyAllowed(${account})`] },
    );
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("allows batches through the delegated allower", async () => {
    const other = parse(Address, padHex("0xb0b2", { size: 20 }));
    const done = parse(Address, padHex("0xd0e", { size: 20 }));
    mocks.multicall.mockImplementationOnce(({ contracts }) =>
      Promise.resolve(
        contracts.map(({ args: [current] }) => ({ result: current === done, status: "success" as const })),
      ),
    );

    await batchFinished([account, done, other]);

    expect(mocks.wallet).toHaveBeenCalledExactlyOnceWith(
      allower,
      [...NETWORKS.values()].find(({ id }) => id === chain.id),
    );
    expect(mocks.multicall).toHaveBeenCalledExactlyOnceWith({
      contracts: [account, done, other].map((current) => ({
        address: firewall,
        functionName: "isAllowed",
        args: [current],
        abi: firewallAbi,
      })),
      batchSize: 65_536,
      deployless: true,
    });
    expect(mocks.getDelegation).toHaveBeenCalledExactlyOnceWith({ address: allower.address });
    expect(mocks.signAuthorization).toHaveBeenCalledExactlyOnceWith({
      account: allower,
      contractAddress: simple7702AccountAddress,
      executor: "self",
    });
    expect(mocks.sendTransaction).toHaveBeenCalledExactlyOnceWith({
      authorizationList: [authorization],
      to: allower.address,
    });
    expect(mocks.waitForTransactionReceipt).toHaveBeenCalledExactlyOnceWith({ hash });
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "firewall.allow", op: "exa.firewall", attributes: { accounts: 2, chainId: chain.id } },
      batch(firewall, [account, other]),
      {},
    );
    expect(mocks.waitForTransactionReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.exaSend.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.enqueuePoke).toHaveBeenCalledTimes(3);
    for (const current of [account, done, other]) {
      expect(mocks.enqueuePoke).toHaveBeenCalledWith({ ...request, account: current, origin: "allow" });
    }
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("keeps an existing allower delegation", async () => {
    mocks.getDelegation.mockResolvedValueOnce(simple7702AccountAddress);
    mocks.multicall.mockResolvedValueOnce([{ result: false, status: "success" }]);

    await batchFinished([account]);

    expect(mocks.signAuthorization).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "firewall.allow", op: "exa.firewall", attributes: { accounts: 1, chainId: chain.id } },
      batch(firewall, [account]),
      {},
    );
    expect(mocks.enqueuePoke).toHaveBeenCalledExactlyOnceWith({ ...request, origin: "allow" });
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("skips batches already allowed", async () => {
    await batchFinished([account]);

    expect(mocks.multicall).toHaveBeenCalledOnce();
    expect(mocks.getDelegation).not.toHaveBeenCalled();
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(mocks.enqueuePoke).toHaveBeenCalledExactlyOnceWith({ ...request, origin: "allow" });
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("allows batches on other chains without poking", async () => {
    mocks.multicall.mockResolvedValueOnce([{ status: "failure" }]);

    await batchFinished([account], baseSepolia.id);

    expect(mocks.wallet).toHaveBeenCalledExactlyOnceWith(allower, NETWORKS.get("BASE_SEPOLIA"));
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "firewall.allow", op: "exa.firewall", attributes: { accounts: 1, chainId: baseSepolia.id } },
      batch(firewall, [account]),
      { fees: "auto" },
    );
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("captures batch failures without a user", async () => {
    const error = new Error("batch failed");
    const setUser = await spyScopeSetUser();
    mocks.multicall.mockResolvedValueOnce([{ result: false, status: "success" }]);
    mocks.exaSend.mockRejectedValueOnce(error);

    await expect(batchFinished([account])).rejects.toThrow("batch failed");

    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account: undefined, attempts: 1, id: "batch" },
      level: "error",
      tags: { queue: "allow", job: "allow", chainId: chain.id },
    });
  });

  it("fails on unsupported chains", async () => {
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account, undefined, { chainId: 0 })).rejects.toThrow("unsupported chain 0");

    expect(mocks.wallet).not.toHaveBeenCalled();
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(new Error("unsupported chain 0"), {
      extra: { account, attempts: 1, id: account },
      level: "error",
      tags: { queue: "allow", job: "allow", chainId: 0 },
    });
  });

  it("queues the poke only after allow settles", async () => {
    const deferred = Promise.withResolvers<object>();
    mocks.exaSend.mockReturnValueOnce(deferred.promise);

    const processing = jobFinished(account);
    await vi.waitUntil(() => mocks.exaSend.mock.calls.length === 1);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    deferred.resolve({});
    await processing;

    expect(mocks.enqueuePoke).toHaveBeenCalledOnce();
  });

  it("closes the poke queue after active jobs settle", async () => {
    const deferred = Promise.withResolvers<object>();
    mocks.exaSend.mockReturnValueOnce(deferred.promise);

    const processing = jobFinished(account);
    await vi.waitUntil(() => mocks.exaSend.mock.calls.length === 1);
    const closeWorker = vi.spyOn(worker.queue, "close");
    const closing = worker.close();
    expect(worker.close()).toBe(closing);
    await vi.waitUntil(() => closeWorker.mock.calls.length === 1);

    expect(mocks.closePoke).not.toHaveBeenCalled();

    deferred.resolve({});
    await processing;
    await closing;
    expect(mocks.closePoke).toHaveBeenCalledExactlyOnceWith();
  });

  it("retries allow failures", async () => {
    mocks.exaSend.mockRejectedValueOnce(new Error("rpc unavailable")).mockResolvedValueOnce({});

    await jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(mocks.enqueuePoke).toHaveBeenCalledExactlyOnceWith({ ...request, origin: "allow" });
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("captures terminal failures", async () => {
    const error = new Error("allow failed");
    const setUser = await spyScopeSetUser();
    mocks.exaSend.mockRejectedValue(error);

    await expect(
      jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 }, removeOnFail: false }),
    ).rejects.toThrow("allow failed");

    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState(account)).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(account);
    expect(job.failedReason).toBe("allow failed");
    expect(job.attemptsMade).toBe(2);
    expect(job.stacktrace).toHaveLength(2);
    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 2, id: account },
      level: "error",
      tags: { queue: "allow", job: "allow", chainId: chain.id },
    });
    await job.remove();
  });

  it.each([
    ["contract", new ContractFunctionRevertedError({ abi: auditorAbi, functionName: "firewall" })],
    ["empty", new ContractFunctionRevertedError({ abi: auditorAbi, data: "0x", functionName: "firewall" })],
    ["node", new ExecutionRevertedError()],
  ])("skips chains whose auditor reverts on firewall with %s errors", async (_, error) => {
    mocks.readContract.mockRejectedValue(error);

    await jobFinished(account);

    expect(mocks.readContract).toHaveBeenCalledExactlyOnceWith({
      address: auditorAddress,
      functionName: "firewall",
      abi: auditorAbi,
    });
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });

  it("skips chains whose auditor has no firewall set", async () => {
    mocks.readContract.mockResolvedValue(parse(Address, zeroAddress));

    await jobFinished(account);

    expect(mocks.readContract).toHaveBeenCalledOnce();
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
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
    mocks.readContract.mockRejectedValue(error);

    await expect(jobFinished(account)).rejects.toThrow(error.message);

    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: error.message }),
      {
        extra: { account, attempts: 1, id: account },
        level: "error",
        tags: { queue: "allow", job: "allow", chainId: chain.id },
      },
    );
  });

  it("retries poke publication failures", async () => {
    const error = new Error("poke unavailable");
    const setUser = await spyScopeSetUser();
    mocks.enqueuePoke.mockRejectedValue(error);

    await expect(jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } })).rejects.toThrow(
      "poke unavailable",
    );

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(mocks.enqueuePoke).toHaveBeenCalledTimes(2);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 2, id: account },
      level: "error",
      tags: { queue: "allow", job: "allow", chainId: chain.id },
    });
  });

  it("continues sentry traces", async () => {
    await jobFinished(account, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(vi.mocked(continueTrace)).toHaveBeenCalledWith(
      { sentryTrace: "trace", baggage: "baggage" },
      expect.any(Function),
    );
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.queue.emit("error", error);

    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "allow" },
    });
  });

  it("captures failed events without a job", async () => {
    const error = new Error("failed event error");
    const setUser = await spyScopeSetUser();

    worker.queue.emit("failed", undefined, error, "active");

    expect(setUser).not.toHaveBeenCalled();
    expect(vi.mocked(captureException)).toHaveBeenCalledExactlyOnceWith(error, {
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

    expect(vi.mocked(captureException)).not.toHaveBeenCalled();
  });
});
