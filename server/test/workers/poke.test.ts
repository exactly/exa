import "../mocks/deployments";
import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/sentry";
import "../mocks/wallet";

import { captureException, continueTrace, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents, Job as QueueJob } from "bullmq";
import { parse } from "valibot";
import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  erc20Abi,
  padHex,
  parseEther,
  zeroHash,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain, { previewerAbi, wethAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import t from "../../i18n";
import { NETWORKS } from "../../utils/alchemy";
import createOnesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import { bullmq } from "../../utils/redis";
import createSegment from "../../utils/segment";
import wallet from "../../utils/wallet";
import createPoke from "../../workers/poke/queue";
import pokeWorker from "../../workers/poke/worker";
import anvilClient from "../anvilClient";

import type { Job as Credit } from "../../workers/credit/job";
import type { Job as Poke } from "../../workers/poke/job";
import type * as sentry from "@sentry/node";
import type { JobsOptions } from "bullmq";

const eth = parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const token = parse(Address, wethAddress);
const token2 = parse(Address, inject("USDC"));
const unknownAsset = parse(Address, "0x3333333333333333333333333333333333333333");
const weth = parse(Address, wethAddress);
const poker = privateKeyToAccount(padHex("0xb0b"));
const poke = createPoke(bullmq);
const mocks = vi.hoisted(() => ({
  closeSegment: vi.fn(),
  segmentOn: vi.fn<(event: string, listener: (error: Error) => void) => void>(),
  track: vi.fn(),
}));

vi.mock("@segment/analytics-node", () => ({
  Analytics: class {
    closeAndFlush = mocks.closeSegment;
    on = mocks.segmentOn;
    track = mocks.track;
  },
}));

const onesignal = createOnesignal("onesignal");
let segment: ReturnType<typeof createSegment>;
let account: Address;
let request: Parameters<ReturnType<typeof createPoke>["enqueue"]>[0];

const credits = new Queue<Credit, void, "credit">("credit", { connection: bullmq });
const queue = new Queue<Poke, void, "poke">("poke", { connection: bullmq });
const events = new QueueEvents("poke", { connection: bullmq });
let worker: Awaited<ReturnType<typeof pokeWorker>>;
let segmentError: ((error: Error) => void) | undefined;
let segmentEvent: string | undefined;

async function jobFinished(
  current: Parameters<ReturnType<typeof createPoke>["enqueue"]>[0],
  options?: JobsOptions,
  trace?: Pick<Poke, "sentryBaggage" | "sentryTrace">,
) {
  const id = [current.chainId, current.account, ...(current.assets ?? [])].join("-");
  const job = await queue.add(
    "poke",
    { ...current, ...trace },
    { attempts: 1, jobId: id, removeOnComplete: true, removeOnFail: true, ...options },
  );
  await job.waitUntilFinished(events).catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
  return job;
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

async function spySpanSetAttribute() {
  const { startSpan: realStartSpan } = await vi.importActual<typeof sentry>("@sentry/node");
  const setAttribute = vi.fn();
  vi.mocked(startSpan).mockImplementation(((options, callback) =>
    realStartSpan(options, (span) => {
      const originalSetAttribute = span.setAttribute.bind(span);
      span.setAttribute = (...args: Parameters<typeof span.setAttribute>) => {
        setAttribute(...args);
        return originalSetAttribute(...args);
      };
      return callback(span);
    })) as typeof startSpan);
  return setAttribute;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  mocks.closeSegment.mockReset().mockImplementation(() => Promise.resolve());
  mocks.segmentOn.mockReset();
  mocks.track.mockReset();
  sendPushNotificationMock.mockResolvedValue({});
  ({ account, request } = createRequest());
  const waitForReceipt = publicClient.waitForTransactionReceipt;
  vi.spyOn(publicClient, "waitForTransactionReceipt").mockImplementation((parameters) =>
    waitForReceipt({ ...parameters, checkReplacement: false, pollingInterval: 10 }),
  );
  vi.clearAllMocks();
  await queue.drain(true);
  await queue.clean(0, 1000, "completed");
  await queue.clean(0, 1000, "failed");
});
afterAll(async () => {
  await Promise.all([credits.close(), events.close(), queue.close(), poke.close()]);
});

describe("poke queue", () => {
  it("publishes account poke jobs", async () => {
    await expect(poke.enqueue(request)).resolves.toBeUndefined();

    const id = `${request.chainId}-${account}`;
    const job = await queue.getJob(id);
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(id);
    expect(job.name).toBe("poke");
    expect(job.data).toStrictEqual({
      ...request,
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(job.opts).toStrictEqual({
      attempts: 10,
      backoff: { type: "exponential", delay: 1000 },
      jobId: id,
      removeOnComplete: true,
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    });
    await expect(job.getState()).resolves.toBe("waiting");
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "poke",
        op: "queue.publish",
        attributes: { "messaging.destination.name": "poke" },
      }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
    await job.remove();
  });

  it("includes assets in job ids", async () => {
    await poke.enqueue({ ...request, assets: [token] });

    const id = `${request.chainId}-${account}-${token}`;
    const job = await queue.getJob(id);
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(id);
    expect(job.data).toStrictEqual({
      ...request,
      assets: [token],
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    await job.remove();
  });

  it("keeps chains separate in job ids", async () => {
    await Promise.all([poke.enqueue(request), poke.enqueue({ ...request, chainId: 1 })]);

    const [current, mainnet] = await Promise.all([
      queue.getJob(`${request.chainId}-${account}`),
      queue.getJob(`1-${account}`),
    ]);
    if (!current || !mainnet) throw new Error("job not found");
    expect([current.id, mainnet.id]).toStrictEqual([`${request.chainId}-${account}`, `1-${account}`]);
    await Promise.all([current.remove(), mainnet.remove()]);
  });

  it("propagates queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await expect(poke.enqueue(request)).rejects.toThrow(error);

    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("poke worker", () => {
  beforeAll(async () => {
    mocks.segmentOn.mockImplementationOnce((event, listener) => {
      segmentError = listener;
      segmentEvent = event;
    });
    segment = createSegment("segment");
    worker = pokeWorker({ bullmq, onesignal, poker, segment });
    await worker.ready;
  });

  afterAll(() => worker.close());

  it("captures segment errors", () => {
    const error = new Error("segment error");
    if (!segmentError) throw new Error("missing segment error handler");

    segmentError(error);

    expect(segmentEvent).toBe("error");
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error" });
  });

  it("rejects unsupported chains before creating a wallet", async () => {
    const readContract = vi.spyOn(publicClient, "readContract");
    const setUser = await spyScopeSetUser();

    await expect(jobFinished({ ...request, chainId: 0 })).rejects.toThrow("unsupported chain 0");

    expect(wallet).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "unsupported chain 0" }),
      {
        extra: { account, attempts: 1, id: `0-${account}` },
        fingerprint: ["{{ default }}", "unknown"],
        level: "error",
        tags: { queue: "poke", job: "poke" },
      },
    );
  });

  it("deploys and pokes funded accounts after allow", async () => {
    const deposit = parseEther("5");
    const setAttribute = await spySpanSetAttribute();
    await anvilClient.setBalance({ address: account, value: deposit });

    await jobFinished(request);

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(await getWETHMarket(account)).toMatchObject({ floatingDepositAssets: deposit, isCollateral: true });
    expect(wallet).toHaveBeenCalledExactlyOnceWith(poker, NETWORKS.get("ANVIL"));
    expect(mocks.track).toHaveBeenCalledWith({ event: "AccountFunded", userId: account, properties: { source: null } });
    expect(sendPushNotificationMock).toHaveBeenCalledExactlyOnceWith({
      userId: account,
      headings: t("Account assets updated"),
      contents: t("Your funds are ready to use"),
    });
    expect(setAttribute.mock.calls.filter(([attribute]) => attribute === "exa.new")).toStrictEqual([["exa.new", true]]);
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ forceTransaction: true, name: "poke worker" }),
      expect.any(Function),
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "poke", op: "queue.process" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("pokes multiple accounts", async () => {
    const deposit = parseEther("5");
    const requests = Array.from({ length: 3 }, createRequest);
    await Promise.all(
      requests.map(({ account: current }) => anvilClient.setBalance({ address: current, value: deposit })),
    );

    await Promise.all(requests.map(({ request: current }) => jobFinished(current)));

    for (const { account: current } of requests) {
      expect(await getWETHMarket(current)).toMatchObject({ floatingDepositAssets: deposit, isCollateral: true });
    }
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures account funding tracking errors", async () => {
    const error = new Error("tracking error");
    mocks.track.mockImplementationOnce(() => {
      throw error;
    });

    await jobFinished({ ...request, assets: [unknownAsset] });

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith({
      event: "AccountFunded",
      userId: account,
      properties: { source: null },
    });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error" });
  });

  it("pokes weth with eth", async () => {
    const ethDeposit = parseEther("5");
    const wethDeposit = parseEther("2");
    await Promise.all([
      anvilClient.setBalance({ address: account, value: ethDeposit }),
      mint(weth, account, wethDeposit),
    ]);

    await jobFinished({ ...request, assets: [eth, weth] });

    expect(await getWETHMarket(account)).toMatchObject({
      floatingDepositAssets: ethDeposit + wethDeposit,
      isCollateral: true,
    });
    await expect(
      publicClient.readContract({ address: weth, functionName: "balanceOf", args: [account], abi: erc20Abi }),
    ).resolves.toBe(0n);
  });

  it("removes weth from activity retries when eth is funded", async () => {
    const ethDeposit = parseEther("5");
    const wethDeposit = parseEther("2");
    const updateData = vi.spyOn(QueueJob.prototype, "updateData");
    await Promise.all([
      anvilClient.setBalance({ address: account, value: ethDeposit }),
      mint(weth, account, wethDeposit),
    ]);

    await jobFinished({ ...request, assets: [eth, weth], origin: "activity" });

    expect(updateData).toHaveBeenCalledExactlyOnceWith({ ...request, assets: [], origin: "activity" });
    expect(await getWETHMarket(account)).toMatchObject({
      floatingDepositAssets: ethDeposit + wethDeposit,
      isCollateral: true,
    });
    await expect(
      publicClient.readContract({ address: weth, functionName: "balanceOf", args: [account], abi: erc20Abi }),
    ).resolves.toBe(0n);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("treats ignored no balance receipts as idempotent success", async () => {
    const readContract = publicClient.readContract;
    vi.spyOn(publicClient, "readContract").mockImplementation((parameters) =>
      parameters.functionName === "balanceOf" ? Promise.resolve(2n) : readContract(parameters as never),
    );

    await jobFinished({ ...request, assets: [token] });

    expect(await getWETHMarket(account)).toMatchObject({ floatingDepositAssets: 0n, isCollateral: false });
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith({
      event: "AccountFunded",
      userId: account,
      properties: { source: null },
    });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures notification errors without retrying", async () => {
    const error = new Error("notification error");
    const deposit = parseEther("2");
    await mint(token, account, deposit);
    sendPushNotificationMock.mockRejectedValueOnce(error);

    await jobFinished({ ...request, assets: [token] });

    expect(await getWETHMarket(account)).toMatchObject({ floatingDepositAssets: deposit, isCollateral: true });
    expect(sendPushNotificationMock).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error" });
  });

  it("queues credit after activity pokes", async () => {
    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });
    const job = await jobFinished({ ...request, assets: [eth], origin: "activity" });

    const credit = await credits.getJob(`poke-${job.id}`);
    if (!credit) throw new Error("credit job not found");
    expect(credit.id).toBe(`poke-${job.id}`);
    expect(credit.name).toBe("credit");
    expect(credit.data).toStrictEqual({
      account,
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(credit.opts).toStrictEqual({
      attempts: 10,
      backoff: { type: "exponential", delay: 1000 },
      jobId: `poke-${job.id}`,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    });
    expect(await getWETHMarket(account)).toMatchObject({ floatingDepositAssets: deposit, isCollateral: true });
    await credit.remove();
  });

  it("retries activity when credit cannot be queued", async () => {
    const error = new Error("credit unavailable");
    const deposit = parseEther("5");
    const add = queue.add.bind(queue);
    await anvilClient.setBalance({ address: account, value: deposit });
    vi.spyOn(Queue.prototype, "add").mockImplementation((jobName: string, data: unknown, options?: JobsOptions) => {
      if (jobName === "credit") return Promise.reject(error);
      return add(jobName as "poke", data as Poke, options);
    });

    await expect(
      jobFinished(
        { ...request, assets: [eth], origin: "activity" },
        { attempts: 2, backoff: { type: "fixed", delay: 1 } },
      ),
    ).rejects.toThrow("credit unavailable");

    expect(await getWETHMarket(account)).toMatchObject({ floatingDepositAssets: deposit, isCollateral: true });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 2, id: `${request.chainId}-${account}-${eth}` },
      fingerprint: ["{{ default }}", "unknown"],
      level: "error",
      tags: { queue: "poke", job: "poke" },
    });
  });

  it("treats empty balances as an idempotent success", async () => {
    await jobFinished({ ...request, assets: [token] });

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(await getWETHMarket(account)).toMatchObject({ floatingDepositAssets: 0n, isCollateral: false });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("retries activity until its balance is visible", async () => {
    const deposit = parseEther("5");
    const getBalance = publicClient.getBalance;
    vi.spyOn(publicClient, "getBalance")
      .mockImplementationOnce(async () => {
        await anvilClient.setBalance({ address: account, value: deposit });
        return 0n;
      })
      .mockImplementation((parameters) => getBalance(parameters));

    await jobFinished(
      { ...request, assets: [eth], origin: "activity" },
      { attempts: 2, backoff: { type: "fixed", delay: 1 } },
    );

    expect(await getWETHMarket(account)).toMatchObject({ floatingDepositAssets: deposit, isCollateral: true });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("retries only activity assets that remain pending", async () => {
    const wethDeposit = parseEther("2");
    const usdcDeposit = 2_000_000n;
    const readContract = publicClient.readContract;
    let hidden = true;
    await mint(token, account, wethDeposit);
    vi.spyOn(publicClient, "readContract").mockImplementation(async (parameters) => {
      if (hidden && parameters.functionName === "balanceOf" && parameters.address === token2) {
        hidden = false;
        await mint(token2, account, usdcDeposit);
        return 0n as never;
      }
      return readContract(parameters as never);
    });

    await jobFinished(
      { ...request, assets: [token, token2], origin: "activity" },
      { attempts: 2, backoff: { type: "fixed", delay: 1 } },
    );

    expect(hidden).toBe(false);
    expect(await getMarket(account, token)).toMatchObject({ floatingDepositAssets: wethDeposit, isCollateral: true });
    expect(await getMarket(account, token2)).toMatchObject({
      floatingDepositAssets: usdcDeposit - 1n,
      isCollateral: true,
    });
  });

  it("captures exhausted activity as a no balance warning", async () => {
    const setUser = await spyScopeSetUser();
    const id = `${request.chainId}-${account}-${token}`;

    await expect(
      jobFinished({ ...request, assets: [token], origin: "activity" }, { removeOnFail: false }),
    ).rejects.toThrow("NoBalance()");

    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState(id)).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(id);
    expect(job.failedReason).toBe("NoBalance()");
    expect(job.attemptsMade).toBe(1);
    expect(job.stacktrace).toHaveLength(1);
    expect(setUser.mock.calls).toStrictEqual([[{ id: account }], [{ id: account }]]);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "NoBalance()" }), {
      extra: { account, attempts: 1, id },
      fingerprint: ["{{ default }}", "NoBalance"],
      level: "warning",
      tags: { queue: "poke", job: "poke" },
    });
    await job.remove();
  });

  it("deploys without poking on other chains", async () => {
    const network = NETWORKS.get("ANVIL");
    if (!network) throw new Error("missing anvil");
    const readContract = vi.spyOn(publicClient, "readContract");
    const id = chain.id;
    Object.assign(chain, { id: 1 });

    try {
      await jobFinished({ ...request, chainId: network.id });
    } finally {
      Object.assign(chain, { id });
    }

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(wallet).toHaveBeenCalledExactlyOnceWith(poker, network);
    expect(readContract).not.toHaveBeenCalled();
  });

  it("deploys activity accounts funded with unsupported assets", async () => {
    const job = await jobFinished({ ...request, assets: [unknownAsset], origin: "activity" });

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(mocks.track).toHaveBeenCalledWith({ event: "AccountFunded", userId: account, properties: { source: null } });
    const credit = await credits.getJob(`poke-${job.id}`);
    if (!credit) throw new Error("credit job not found");
    expect(credit.data.account).toBe(account);
    await credit.remove();
  });

  it("retries rpc failures", async () => {
    const readContract = publicClient.readContract;
    vi.spyOn(publicClient, "readContract")
      .mockRejectedValueOnce(new Error("rpc unavailable"))
      .mockImplementation((parameters) => readContract(parameters as never));

    await jobFinished({ ...request, assets: [token] }, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures terminal failures", async () => {
    const error = new Error("poke failed");
    const setUser = await spyScopeSetUser();
    const id = `${request.chainId}-${account}-${token}`;
    vi.spyOn(publicClient, "readContract").mockRejectedValue(error);

    await expect(
      jobFinished(
        { ...request, assets: [token] },
        { attempts: 2, backoff: { type: "fixed", delay: 1 }, removeOnFail: false },
      ),
    ).rejects.toThrow("poke failed");

    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState(id)).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(id);
    expect(job.failedReason).toBe("poke failed");
    expect(job.attemptsMade).toBe(2);
    expect(job.stacktrace).toHaveLength(2);
    expect(setUser.mock.calls).toStrictEqual([[{ id: account }], [{ id: account }]]);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 2, id },
      fingerprint: ["{{ default }}", "unknown"],
      level: "error",
      tags: { queue: "poke", job: "poke" },
    });
    await job.remove();
  });

  it("fingerprints terminal reverts by error name", async () => {
    const abi = [{ type: "error", name: "Unauthorized", inputs: [] }] as const;
    const error = new BaseError("test", {
      cause: new ContractFunctionRevertedError({
        abi,
        data: encodeErrorResult({ abi, errorName: "Unauthorized" }),
        functionName: "poke",
      }),
    });
    vi.spyOn(publicClient, "readContract").mockRejectedValueOnce(error);

    const setUser = await spyScopeSetUser();

    await expect(jobFinished({ ...request, assets: [token] })).rejects.toThrow("test");

    expect(setUser.mock.calls).toStrictEqual([[{ id: account }], [{ id: account }]]);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 1, id: `${request.chainId}-${account}-${token}` },
      fingerprint: ["{{ default }}", "Unauthorized"],
      level: "error",
      tags: { queue: "poke", job: "poke" },
    });
  });

  it("continues sentry traces", async () => {
    await jobFinished({ ...request, assets: [unknownAsset] }, undefined, {
      sentryBaggage: "baggage",
      sentryTrace: "trace",
    });

    expect(continueTrace).toHaveBeenCalledWith({ sentryTrace: "trace", baggage: "baggage" }, expect.any(Function));
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.queue.emit("error", error);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error", tags: { queue: "poke" } });
  });

  it("captures failed events without a job", async () => {
    const error = new Error("failed event error");
    const setUser = await spyScopeSetUser();

    worker.queue.emit("failed", undefined, error, "active");

    expect(setUser).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account: undefined, attempts: undefined, id: undefined },
      fingerprint: ["{{ default }}", "unknown"],
      level: "error",
      tags: { queue: "poke", job: undefined },
    });
  });

  it("skips intermediate failed events", () => {
    const error = new Error("failed event error");

    worker.queue.emit(
      "failed",
      { attemptsMade: 9, data: request, name: "poke", opts: {} } as unknown as Awaited<ReturnType<typeof queue.add>>,
      error,
      "active",
    );

    expect(captureException).not.toHaveBeenCalled();
  });
});

function createRequest() {
  const owner = privateKeyToAccount(generatePrivateKey());
  const address = deriveAddress(inject("ExaAccountFactory"), { x: padHex(owner.address), y: zeroHash });
  return {
    account: address,
    request: {
      account: address,
      chainId: chain.id,
      factory: inject("ExaAccountFactory"),
      origin: "allow",
      publicKey: owner.address,
      source: null,
    } satisfies Parameters<ReturnType<typeof createPoke>["enqueue"]>[0],
  };
}

async function getMarket(address: Address, asset: Address) {
  return publicClient
    .readContract({ address: inject("Previewer"), functionName: "exactly", abi: previewerAbi, args: [address] })
    .then((markets) => markets.find((current) => current.asset === asset));
}

const getWETHMarket = (address: Address) => getMarket(address, token);

async function mint(asset: Address, address: Address, amount: bigint) {
  await anvilClient.writeContract({
    account: null,
    address: asset,
    functionName: "mint",
    args: [address, amount],
    abi: [
      {
        type: "function",
        name: "mint",
        inputs: [{ type: "address" }, { type: "uint256" }],
        outputs: [],
        stateMutability: "nonpayable",
      },
    ],
  });
}
