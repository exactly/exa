import "../mocks/sentry";
import "../mocks/wallet";

import { KeyManagementServiceClient } from "@google-cloud/kms";
import { captureException, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents, type Job, type JobsOptions } from "bullmq";
import { eq, inArray } from "drizzle-orm";
import { parse } from "valibot";
import {
  concatHex,
  ContractFunctionRevertedError,
  createTestClient,
  encodeErrorResult,
  hexToBytes,
  http,
  HttpRequestError,
  InternalRpcError,
  keccak256,
  padHex,
  publicActions,
  toHex,
  walletActions,
  zeroAddress,
  zeroHash,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { moonbeamDev } from "viem/chains";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
  type MockInstance,
} from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain, {
  activityChains,
  auditorAbi,
  chains,
  exaAccountFactoryAddress,
  exaPreviewerAbi,
  firewallAbi,
  simple7702AccountAddress,
} from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { credentials, organizations } from "../../database";
import { bullmq } from "../../utils/redis";
import wallet, { signer } from "../../utils/wallet";
import createAllow from "../../workers/allow/queue";
import allowWorker from "../../workers/allow/worker";
import { finished, tip } from "../redis";

import type { Job as Allow, Batch } from "../../workers/allow/job";
import type { Job as Poke } from "../../workers/poke/job";
import type * as sentry from "@sentry/node";
import type { EventEmitter } from "node:events";

const anvil = activityChains.get(chain.id);
const anvil2 = activityChains.get(moonbeamDev.id);
if (!anvil?.smartAccount || !anvil2?.smartAccount) throw new Error("missing local networks");
const anvil2Client = createTestClient({ chain: anvil2, mode: "anvil", transport: http() })
  .extend(publicActions)
  .extend(walletActions);
const { firewall } = await anvil2Client.readContract({
  address: parse(Address, chains.get(moonbeamDev.id)?.exaPreviewer),
  functionName: "discover",
  args: [[]],
  abi: exaPreviewerAbi,
});
const kms = new KeyManagementServiceClient();
const allower = await signer("allower", kms);
const factory = parse(Address, exaAccountFactoryAddress);
const account = parse(Address, padHex("0xb0b", { size: 20 }));
const salt = parse(Address, padHex("0x0", { size: 20 }));
const request = { account, chainId: chain.id, factory, publicKey: "0x1234" as const, salt, source: null };
const allow = createAllow(bullmq);
const queue = new Queue<Allow | Batch, void, "allow">("allow", { connection: bullmq });
const events = new QueueEvents("allow", { connection: bullmq, lastEventId: await tip(bullmq, queue) });
const pokes = new Queue<Poke, void, "poke">("poke", { connection: bullmq });
const pokeEvents = new QueueEvents("poke", { connection: bullmq, lastEventId: await tip(bullmq, pokes) });
let worker: Awaited<ReturnType<typeof allowWorker>>;

async function jobFinished(current: Address, options?: JobsOptions, data?: Partial<Allow>) {
  const result = finished(events, current);
  const job = await queue.add(
    "allow",
    { ...request, account: current, ...data },
    { attempts: 1, jobId: current, removeOnComplete: true, removeOnFail: true, ...options },
  );
  await result;
  return job;
}

async function batchFinished(accounts: Address[], chainId: number = moonbeamDev.id, options?: JobsOptions) {
  const id = [chainId, keccak256(concatHex(accounts))].join("-");
  const result = finished(events, id);
  if (options) {
    const { addBulk } = Queue.prototype; // eslint-disable-line @typescript-eslint/unbound-method
    vi.spyOn(Queue.prototype, "addBulk").mockImplementationOnce(function (this: Queue, jobs) {
      return addBulk.call(
        this,
        jobs.map((job) => ({ ...job, opts: { ...job.opts, ...options } })),
      );
    });
  }
  await allow.backfill(
    chainId,
    accounts.map((current) => ({ ...request, account: current })),
  );
  await result;
  return id;
}

function poked(chainId: number, current: Address) {
  const emitter: EventEmitter = pokeEvents;
  return new Promise<Address>((resolve) => {
    emitter.once(`added:${chainId}-${current}`, () => resolve(current));
  });
}

function withoutPoke(chainId: number, current: Address) {
  const emitter: EventEmitter = pokeEvents;
  const event = `added:${chainId}-${current}`;
  let published = false;
  function added() {
    published = true;
  }
  emitter.on(event, added);
  onTestFinished(() => {
    emitter.off(event, added);
  });
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    emitter.off(event, added);
    return !published;
  };
}

function random() {
  return parse(Address, privateKeyToAddress(generatePrivateKey()));
}

function allowlist(current: Address) {
  return anvil2Client.readContract({ address: firewall, functionName: "allowlist", args: [current], abi: firewallAbi });
}

async function allowed(fromBlock: bigint, accounts: readonly Address[]) {
  const logs = await anvil2Client.getContractEvents({
    address: firewall,
    abi: firewallAbi,
    eventName: "Allowed",
    fromBlock: fromBlock - 1n,
  });
  return logs.flatMap(({ args, blockNumber }) =>
    blockNumber >= fromBlock && args.account && (accounts as readonly string[]).includes(args.account)
      ? [{ account: parse(Address, args.account), allower: args.allower }]
      : [],
  );
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

function spyWallet(spy: (client: ReturnType<typeof wallet>) => unknown) {
  const create = vi.mocked(wallet).getMockImplementation();
  if (!create) throw new Error("missing wallet");
  vi.mocked(wallet).mockImplementation((...parameters) => {
    const client = create(...parameters);
    spy(client);
    return client;
  });
  onTestFinished(() => {
    vi.mocked(wallet).mockImplementation(create);
  });
}

function spyBackfill() {
  const settled: Promise<void>[] = [];
  const { addBulk } = Queue.prototype; // eslint-disable-line @typescript-eslint/unbound-method
  const spy = vi.spyOn(Queue.prototype, "addBulk").mockImplementation(function (this: Queue, jobs) {
    settled.push(...jobs.map(({ opts }) => finished(events, String(opts?.jobId))));
    return addBulk.call(this, jobs);
  });
  return Object.assign(spy, { settled: () => Promise.all(settled) });
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
  await Promise.all([events.close(), queue.close(), pokeEvents.close(), pokes.close(), allow.close(), kms.close()]);
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("allow queue", () => {
  it("publishes firewall allow jobs", async () => {
    const add = vi.spyOn(Queue.prototype, "add");

    await expect(allow.enqueue(request)).resolves.toBeUndefined();

    const job = await (add.mock.results[0]?.value as Promise<Job> | undefined);
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(`${chain.id}-${account}`);
    expect(job.name).toBe("allow");
    expect(job.data).toEqual({
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
    expect(startSpan).toHaveBeenCalledWith(
      { name: "allow", op: "queue.publish", attributes: { "messaging.destination.name": "allow" } },
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
    await queue.remove(`${chain.id}-${account}`);
  });

  it("publishes prioritized backfill batches in bulk", async () => {
    const accounts = Array.from({ length: 101 }, (_, index) => ({
      account: parse(Address, padHex(toHex(index + 1), { size: 20 })),
      factory,
      publicKey: "0x1234" as const,
      salt,
      source: index === 0 ? "client" : null,
    }));

    const addBulk = vi.spyOn(Queue.prototype, "addBulk");

    await expect(allow.backfill(moonbeamDev.id, accounts)).resolves.toBeUndefined();

    const results = await Promise.all(addBulk.mock.results.map(({ value }) => value as Promise<Job[]>));
    const published = results.flat();
    for (const [index, chunk] of [accounts.slice(0, 100), accounts.slice(100)].entries()) {
      const id = `${moonbeamDev.id}-${keccak256(concatHex(chunk.map(({ account: current }) => current)))}`;
      const job = published[index];
      if (!job) throw new Error("job not found");
      expect(job.id).toBe(id);
      expect(job.name).toBe("allow");
      expect(job.data).toEqual({
        accounts: chunk,
        chainId: moonbeamDev.id,
        sentryBaggage: expect.any(String) as string,
        sentryTrace: expect.any(String) as string,
      });
      expect(job.opts).toEqual({
        attempts: 10,
        backoff: { type: "exponential", delay: 1000 },
        jobId: id,
        priority: 1,
        removeOnComplete: true,
        removeOnFail: true,
      });
      await queue.remove(id);
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
  const owners = new Map<Address, Hex>();
  const persona = owned();
  const sourced = owned();
  const done = owned();
  const partner = owned();
  const pending = owned();
  const orphan = owned(parse(Address, padHex("0xfac", { size: 20 })));
  const accounts = [persona, sourced, done, partner, pending, orphan];

  function owned(from = factory) {
    const owner = toHex(hexToBytes(privateKeyToAddress(generatePrivateKey())));
    const derived = deriveAddress(from, { x: padHex(owner), y: zeroHash });
    owners.set(derived, owner);
    return derived;
  }

  beforeAll(async () => {
    await allowOnChain(done);
    await database
      .insert(organizations)
      .values({ id: "allow-partner", name: "partner", slug: "allow-partner", createdAt: new Date(), role: "kyc" });
    await database.insert(credentials).values([
      ...accounts.map((current) => ({
        id: `allow-${current}`,
        account: current,
        factory: current === orphan ? padHex("0xfac", { size: 20 }) : factory,
        publicKey: new Uint8Array(hexToBytes(owners.get(current) ?? "0x")),
        pandaId: current === pending ? null : `panda-${current}`,
        source: current === partner ? "allow-partner" : current === sourced ? "allow-client" : null,
      })),
    ]);
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
    const addBulk = spyBackfill();
    const fromBlock = (await anvil2Client.getBlockNumber({ cacheTime: 0 })) + 1n;
    const poking = Promise.all([persona, sourced].map((current) => poked(moonbeamDev.id, current)));

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;
    await addBulk.settled();

    await expect(
      Promise.all(accounts.map(async (current) => (await allowlist(current)) !== zeroAddress)),
    ).resolves.toStrictEqual([true, true, true, false, false, false]);
    for (const { allower: delegated } of await allowed(fromBlock, [persona, sourced])) {
      if (!delegated) throw new Error("missing allower");
      await expect(anvil2Client.getDelegation({ address: delegated })).resolves.toBe(simple7702AccountAddress);
    }
    const jobs = backfilled(addBulk);
    expect(jobs.map(({ data }) => data.chainId)).toStrictEqual(jobs.map(() => moonbeamDev.id));
    expect(jobs.map(({ opts }) => opts.priority)).toStrictEqual(jobs.map(() => 1));
    const batched = jobs.flatMap(({ data }) => data.accounts);
    expect(batched).toStrictEqual(
      expect.arrayContaining([
        { account: persona, factory, publicKey: owners.get(persona), salt, source: null },
        { account: sourced, factory, publicKey: owners.get(sourced), salt, source: "allow-client" },
      ]),
    );
    expect(batched.filter(({ account: current }) => [done, partner, pending].includes(current))).toStrictEqual([]);
    expect(batched.find(({ account: current }) => current === orphan)).toBeUndefined();
    await expect(poking).resolves.toStrictEqual([persona, sourced]);
    expect(captures()).toStrictEqual([]);
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
    expect(captures()).toStrictEqual([]);
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
    expect(captures()).toStrictEqual([
      [
        new Error("allower not ready"),
        { level: "warning", tags: { queue: "allow", chainId: moonbeamDev.id }, extra: { role: true, balance: 0n } },
      ],
    ]);
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
    expect(captures()).toStrictEqual([
      [
        new Error("allower not ready"),
        {
          level: "warning",
          tags: { queue: "allow", chainId: moonbeamDev.id },
          extra: { role: false, balance: await anvil2Client.getBalance({ address: allower.address }) },
        },
      ],
    ]);
  });

  it("captures chain failures without stopping other chains", async () => {
    const unavailable = new HttpRequestError({ url: "https://rpc.test" });
    const reads: MockInstance[] = [];
    spyWallet((client) =>
      client.chain.id === chain.id
        ? vi.spyOn(client, "readContract").mockRejectedValue(unavailable)
        : reads.push(vi.spyOn(client, "readContract")),
    );

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;

    expect(wallet).toHaveBeenCalledWith(allower, anvil);
    expect(wallet).toHaveBeenCalledWith(allower, anvil2);
    expect(reads.flatMap(({ mock }) => mock.calls)).toContainEqual([
      expect.objectContaining({ functionName: "hasRole" }),
    ]);
    expect(captures()).toStrictEqual([[unavailable, { level: "error", tags: { queue: "allow", chainId: chain.id } }]]);
  });

  it("skips credentials whose account is not an address", async () => {
    const addBulk = vi.spyOn(Queue.prototype, "addBulk");
    const select = vi.spyOn(database, "select").mockReturnValueOnce({
      from: () => ({
        where: () =>
          Promise.resolve([
            {
              account: "allow-invalid",
              factory,
              publicKey: new Uint8Array(hexToBytes(privateKeyToAddress(generatePrivateKey()))),
              salt,
              source: null,
            },
          ]),
      }),
    } as unknown as ReturnType<typeof database.select>);

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;

    expect(select).toHaveBeenCalled();
    expect(addBulk).not.toHaveBeenCalled();
    expect(captures()).toStrictEqual([]);
  });

  it("captures database failures without failing", async () => {
    const error = new Error("database unavailable");
    vi.spyOn(database, "select").mockReturnValueOnce({
      from: () => ({ where: () => Promise.reject(error) }),
    } as unknown as ReturnType<typeof database.select>);

    const addBulk = vi.spyOn(Queue.prototype, "addBulk");

    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;

    expect(addBulk).not.toHaveBeenCalled();
    expect(captures()).toStrictEqual([[error, { level: "error", tags: { queue: "allow" } }]]);
  });
});

describe("allow worker", () => {
  beforeEach(async () => {
    const addBulk = spyBackfill();
    worker = allowWorker({ allower, bullmq, database });
    await worker.ready;
    await addBulk.settled();
    addBulk.mockRestore();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await worker.close();
  });

  it("skips chains without a firewall", async () => {
    const quiet = withoutPoke(chain.id, account);

    await jobFinished(account);

    await expect(quiet()).resolves.toBe(true);
    expect(captures(account)).toStrictEqual([]);
  });

  it("allows and pokes other chains", async () => {
    const current = random();
    const poke = poked(moonbeamDev.id, current);

    await jobFinished(current, undefined, { chainId: moonbeamDev.id });

    await expect(allowlist(current)).resolves.not.toBe(zeroAddress);
    await expect(poke).resolves.toBe(current);
    expect(captures(current)).toStrictEqual([]);
  });

  it("pokes accounts already allowed", async () => {
    const current = random();
    await allowOnChain(current);
    const fromBlock = (await anvil2Client.getBlockNumber({ cacheTime: 0 })) + 1n;
    const poke = poked(moonbeamDev.id, current);

    await jobFinished(current, undefined, { chainId: moonbeamDev.id });

    await expect(poke).resolves.toBe(current);
    await expect(allowed(fromBlock, [current])).resolves.toStrictEqual([]);
    expect(captures(current)).toStrictEqual([]);
  });

  it("allows batches through a delegated allower", async () => {
    const [current, done, other] = [random(), random(), random()];
    await allowOnChain(done);
    await anvil2Client.setCode({ address: allower.address, bytecode: "0x" });
    const fromBlock = (await anvil2Client.getBlockNumber({ cacheTime: 0 })) + 1n;
    const poking = Promise.all([current, done, other].map((poke) => poked(moonbeamDev.id, poke)));

    const id = await batchFinished([current, done, other]);

    const logs = await allowed(fromBlock, [current, done, other]);
    expect(logs.map(({ account: logged }) => logged)).toStrictEqual([current, other]);
    for (const { allower: delegated } of logs) {
      if (!delegated) throw new Error("missing allower");
      await expect(anvil2Client.getDelegation({ address: delegated })).resolves.toBe(simple7702AccountAddress);
    }
    await expect(poking).resolves.toStrictEqual([current, done, other]);
    expect(captures(id)).toStrictEqual([]);
  });

  it("keeps an existing allower delegation", async () => {
    const current = random();
    await anvil2Client.setCode({
      address: allower.address,
      bytecode: concatHex(["0xef0100", simple7702AccountAddress]),
    });
    const fromBlock = (await anvil2Client.getBlockNumber({ cacheTime: 0 })) + 1n;
    const poke = poked(moonbeamDev.id, current);

    const id = await batchFinished([current]);

    const [log] = await allowed(fromBlock, [current]);
    if (!log?.allower) throw new Error("missing allow");
    await expect(anvil2Client.getDelegation({ address: log.allower })).resolves.toBe(simple7702AccountAddress);
    await expect(authorizations(fromBlock, log.allower)).resolves.toStrictEqual([]);
    await expect(poke).resolves.toBe(current);
    expect(captures(id)).toStrictEqual([]);
  });

  it("retries batches when the allower delegation is skipped", async () => {
    const current = random();
    const quiet = withoutPoke(moonbeamDev.id, current);
    await anvil2Client.setCode({ address: allower.address, bytecode: "0x" });
    const { signAuthorization } = allower;
    vi.spyOn(allower, "signAuthorization").mockImplementationOnce((authorization) =>
      signAuthorization({ ...authorization, nonce: authorization.nonce + 1 }),
    );
    const id = [moonbeamDev.id, keccak256(current)].join("-");

    await expect(batchFinished([current], moonbeamDev.id, { attempts: 1 })).rejects.toThrow("allower not delegated");

    await expect(anvil2Client.getDelegation({ address: allower.address })).resolves.toBeUndefined();
    await expect(allowlist(current)).resolves.toBe(zeroAddress);
    await expect(quiet()).resolves.toBe(true);
    expect(captures(id)).toStrictEqual([
      [
        new Error("allower not delegated"),
        {
          extra: { account: undefined, attempts: 1, id },
          level: "error",
          tags: { queue: "allow", job: "allow", chainId: moonbeamDev.id },
        },
      ],
    ]);
  });

  it("skips batches already allowed", async () => {
    const current = random();
    await allowOnChain(current);
    const fromBlock = (await anvil2Client.getBlockNumber({ cacheTime: 0 })) + 1n;
    const poke = poked(moonbeamDev.id, current);

    const id = await batchFinished([current]);

    await expect(allowed(fromBlock, [current])).resolves.toStrictEqual([]);
    await expect(poke).resolves.toBe(current);
    expect(captures(id)).toStrictEqual([]);
  });

  it("skips batches on chains without a firewall", async () => {
    const current = random();
    const quiet = withoutPoke(chain.id, current);

    const id = await batchFinished([current], chain.id);

    await expect(quiet()).resolves.toBe(true);
    expect(captures(id)).toStrictEqual([]);
  });

  it("fails batches on unsupported chains", async () => {
    const current = random();
    const quiet = withoutPoke(0, current);

    await expect(batchFinished([current], 0, { attempts: 2, backoff: { type: "fixed", delay: 1 } })).rejects.toThrow(
      "unsupported chain 0",
    );

    await expect(allowlist(current)).resolves.toBe(zeroAddress);
    await expect(quiet()).resolves.toBe(true);
  });

  it("captures batch failures without a user", async () => {
    const error = new Error("batch failed");
    const setUser = await spyScopeSetUser();
    const start = [vi.mocked(captureException).mock.calls.length, setUser.mock.calls.length];

    worker.queue.emit(
      "failed",
      {
        attemptsMade: 1,
        data: { accounts: [{ ...request, account: random() }], chainId: moonbeamDev.id },
        id: "batch",
        name: "allow",
        opts: { attempts: 1 },
      } as unknown as Job,
      error,
      "active",
    );

    expect(setUser.mock.calls.slice(start[1])).toStrictEqual([]);
    expect(vi.mocked(captureException).mock.calls.slice(start[0])).toStrictEqual([
      [
        error,
        {
          extra: { account: undefined, attempts: 1, id: "batch" },
          level: "error",
          tags: { queue: "allow", job: "allow", chainId: moonbeamDev.id },
        },
      ],
    ]);
  });

  it("fails on unsupported chains", async () => {
    const quiet = withoutPoke(0, account);

    await expect(jobFinished(account, undefined, { chainId: 0 })).rejects.toThrow("unsupported chain 0");

    await expect(quiet()).resolves.toBe(true);
  });

  it("queues the poke only after allow settles", async () => {
    const current = random();
    const emitter: EventEmitter = pokeEvents;
    const allowedOnPoke = new Promise<`0x${string}`>((resolve, reject) => {
      emitter.once(`added:${moonbeamDev.id}-${current}`, () => {
        allowlist(current).then(resolve, reject);
      });
    });

    await jobFinished(current, undefined, { chainId: moonbeamDev.id });

    await expect(allowedOnPoke).resolves.not.toBe(zeroAddress);
  });

  it("closes the poke queue after the worker", async () => {
    const close = vi.spyOn(Queue.prototype, "close");
    const closeWorker = vi.spyOn(worker.queue, "close");

    const closing = worker.close();
    expect(worker.close()).toBe(closing);
    await closing;

    const pokeClose = close.mock.contexts.findIndex((context) => (context as Queue).name === "poke");
    expect(pokeClose).not.toBe(-1);
    expect(closeWorker).toHaveBeenCalledOnce();
    expect(closeWorker.mock.invocationCallOrder[0]).toBeLessThan(close.mock.invocationCallOrder[pokeClose] ?? 0);
  });

  it("retries poke publication without allowing twice", async () => {
    const current = random();
    const fromBlock = (await anvil2Client.getBlockNumber({ cacheTime: 0 })) + 1n;
    const poke = poked(moonbeamDev.id, current);
    const add = Queue.prototype.add; // eslint-disable-line @typescript-eslint/unbound-method
    let unavailable = true;
    vi.spyOn(Queue.prototype, "add").mockImplementation(function (this: Queue, ...parameters) {
      if (unavailable && this.name === "poke" && (parameters[1] as Poke).account === current) {
        unavailable = false;
        return Promise.reject(new Error("poke unavailable"));
      }
      return add.apply(this, parameters);
    });

    await jobFinished(current, { attempts: 2, backoff: { type: "fixed", delay: 1 } }, { chainId: moonbeamDev.id });

    await expect(allowed(fromBlock, [current])).resolves.toStrictEqual([
      { account: current, allower: expect.any(String) as string },
    ]);
    await expect(poke).resolves.toBe(current);
    expect(captures(current)).toStrictEqual([]);
  });

  it("keeps terminal failures", async () => {
    const current = random();
    const quiet = withoutPoke(0, current);

    await expect(
      jobFinished(current, { attempts: 2, backoff: { type: "fixed", delay: 1 }, removeOnFail: false }, { chainId: 0 }),
    ).rejects.toThrow("unsupported chain 0");

    await expect(queue.getJobState(current)).resolves.toBe("failed");
    const job = await queue.getJob(current);
    if (!job) throw new Error("job not found");
    expect(job.failedReason).toBe("unsupported chain 0");
    expect(job.attemptsMade).toBe(2);
    expect(job.stacktrace).toHaveLength(2);
    await expect(quiet()).resolves.toBe(true);
    await job.remove();
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
  ])("captures terminal %s failures", async (_, error) => {
    const setUser = await spyScopeSetUser();
    const start = [vi.mocked(captureException).mock.calls.length, setUser.mock.calls.length];

    worker.queue.emit(
      "failed",
      {
        attemptsMade: 1,
        data: { ...request, chainId: moonbeamDev.id },
        id: account,
        name: "allow",
        opts: { attempts: 1 },
      } as unknown as Job,
      error,
      "active",
    );

    expect(setUser.mock.calls.slice(start[1])).toStrictEqual([[{ id: account }]]);
    expect(vi.mocked(captureException).mock.calls.slice(start[0])).toStrictEqual([
      [
        error,
        {
          extra: { account, attempts: 1, id: account },
          level: "error",
          tags: { queue: "allow", job: "allow", chainId: moonbeamDev.id },
        },
      ],
    ]);
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");
    const start = vi.mocked(captureException).mock.calls.length;

    worker.queue.emit("error", error);

    expect(vi.mocked(captureException).mock.calls.slice(start)).toStrictEqual([
      [error, { level: "error", tags: { queue: "allow" } }],
    ]);
  });

  it("captures failed events without a job", async () => {
    const error = new Error("failed event error");
    const setUser = await spyScopeSetUser();
    const start = [vi.mocked(captureException).mock.calls.length, setUser.mock.calls.length];

    worker.queue.emit("failed", undefined, error, "active");

    expect(setUser.mock.calls.slice(start[1])).toStrictEqual([]);
    expect(vi.mocked(captureException).mock.calls.slice(start[0])).toStrictEqual([
      [
        error,
        {
          extra: { account: undefined, attempts: undefined, id: undefined },
          level: "error",
          tags: { queue: "allow", job: undefined, chainId: undefined },
        },
      ],
    ]);
  });

  it("skips intermediate failed events with default attempts", () => {
    const error = new Error("failed event error");
    const start = vi.mocked(captureException).mock.calls.length;

    worker.queue.emit(
      "failed",
      { attemptsMade: 9, data: { account }, name: "allow", opts: {} } as Job,
      error,
      "active",
    );

    expect(vi.mocked(captureException).mock.calls.slice(start)).toStrictEqual([]);
  });
});

function captures(...ids: string[]) {
  return vi.mocked(captureException).mock.calls.filter(([, hint]) => {
    const id = (hint as undefined | { extra?: { id?: unknown } })?.extra?.id;
    return id === undefined || (typeof id === "string" && ids.includes(id));
  });
}

async function authorizations(fromBlock: bigint, from: `0x${string}`) {
  const latest = await anvil2Client.getBlockNumber({ cacheTime: 0 });
  const blocks = await Promise.all(
    Array.from({ length: Number(latest - fromBlock + 1n) }, (_, index) =>
      anvil2Client.getBlock({ blockNumber: fromBlock + BigInt(index), includeTransactions: true }),
    ),
  );
  return blocks.flatMap(({ transactions }) =>
    transactions.filter((transaction) => transaction.from === from.toLowerCase() && transaction.type === "eip7702"),
  );
}
