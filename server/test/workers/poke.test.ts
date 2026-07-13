import "../mocks/deployments";
import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/sentry";

import { captureException, continueTrace, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents, Job as QueueJob } from "bullmq";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import chain, { wethAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import t from "../../i18n";
import { NETWORKS } from "../../utils/alchemy";
import publicClient from "../../utils/publicClient";
import { bullmq } from "../../utils/redis";
import createPoke from "../../workers/poke/queue";
import pokeWorker from "../../workers/poke/worker";

import type { Job as Credit } from "../../workers/credit/job";
import type { Job as Poke } from "../../workers/poke/job";
import type * as sentry from "@sentry/node";
import type { JobsOptions } from "bullmq";

const account = parse(Address, "0xb12057309bdDd6e071d5AAF9714C5f15E02441D6");
const redisUrl = parse(pipe(string(), nonEmpty()), env.REDIS_URL);
const eth = parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const factory = parse(Address, "0x1234567890123456789012345678901234567890");
const market = parse(Address, "0xafc70edeb980d345da3c76786d9689d41804b521");
const market2 = parse(Address, "0x1111111111111111111111111111111111111111");
const token = parse(Address, "0x9876543210987654321098765432109876543210");
const token2 = parse(Address, "0x2222222222222222222222222222222222222222");
const unknownAsset = parse(Address, "0x3333333333333333333333333333333333333333");
const weth = parse(Address, wethAddress);
const salt = parse(Address, padHex("0x0", { size: 20 }));
const request = {
  account,
  chainId: chain.id,
  factory,
  origin: "allow",
  publicKey: "0x1234",
  salt,
  source: null,
} as const;
const poker = privateKeyToAccount(padHex("0xb0b"));
const poke = createPoke(bullmq);
const mocks = vi.hoisted(() => ({
  closeSegment: vi.fn(),
  decodePublicKey: vi.fn(),
  exaSend: vi.fn(),
  getCode: vi.fn(),
  wallet: vi.fn(),
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
vi.mock("../../utils/decodePublicKey", () => ({ default: mocks.decodePublicKey }));
vi.mock("../../utils/wallet", () => ({ default: mocks.wallet }));

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
  const id = [current.account, ...(current.assets ?? [])].join("-");
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
  mocks.decodePublicKey.mockReset().mockReturnValue({ x: "0x01", y: "0x02" });
  mocks.exaSend.mockReset().mockResolvedValue({ status: "success" });
  mocks.getCode.mockReset().mockResolvedValue("0x01");
  mocks.wallet.mockReset().mockReturnValue({ exaSend: mocks.exaSend, getCode: mocks.getCode });
  mocks.segmentOn.mockReset();
  mocks.track.mockReset();
  sendPushNotificationMock.mockResolvedValue({});
  vi.spyOn(publicClient, "getBalance").mockResolvedValue(0n);
  vi.spyOn(publicClient, "readContract").mockResolvedValue([] as never);
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

    const job = await queue.getJob(account);
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(account);
    expect(job.name).toBe("poke");
    expect(job.data).toStrictEqual({
      ...request,
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(job.opts).toStrictEqual({
      attempts: 10,
      backoff: { type: "exponential", delay: 1000 },
      jobId: account,
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

    const job = await queue.getJob(`${account}-${token}`);
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(`${account}-${token}`);
    expect(job.data).toStrictEqual({
      ...request,
      assets: [token],
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    await job.remove();
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
    worker = pokeWorker({ onesignalKey: "onesignal", poker, redisUrl, segmentKey: "segment" });
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
    const setUser = await spyScopeSetUser();

    await expect(jobFinished({ ...request, chainId: 0 })).rejects.toThrow("unsupported chain 0");

    expect(mocks.wallet).not.toHaveBeenCalled();
    expect(publicClient.readContract).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "unsupported chain 0" }),
      {
        extra: { account, attempts: 1, id: account },
        fingerprint: ["{{ default }}", "unknown"],
        level: "error",
        tags: { queue: "poke", job: "poke" },
      },
    );
  });

  it("deploys and pokes funded accounts after allow", async () => {
    const setAttribute = await spySpanSetAttribute();
    mocks.getCode.mockImplementationOnce(() => Promise.resolve());
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(1n);
    vi.mocked(publicClient.readContract).mockImplementation(
      ({ functionName }) => Promise.resolve(functionName === "assets" ? [{ asset: token, market }] : 2n) as never,
    );

    await jobFinished(request);

    expect(mocks.wallet).toHaveBeenCalledExactlyOnceWith(poker, NETWORKS.get("ANVIL"));
    expect(mocks.exaSend).toHaveBeenCalledTimes(3);
    expect(mocks.exaSend).toHaveBeenNthCalledWith(
      1,
      { name: "create account", op: "exa.account", attributes: { account } },
      expect.objectContaining({ address: factory, functionName: "createAccount" }),
      {},
    );
    expect(mocks.exaSend).toHaveBeenCalledWith(
      { name: "poke account", op: "exa.poke", attributes: { account, asset: expect.any(String) as Address } },
      expect.objectContaining({ address: account, functionName: "pokeETH" }),
      { ignore: ["NoBalance()"] },
    );
    expect(mocks.exaSend).toHaveBeenCalledWith(
      { name: "poke account", op: "exa.poke", attributes: { account, asset: token } },
      expect.objectContaining({ address: account, args: [market], functionName: "poke" }),
      { ignore: ["NoBalance()"] },
    );
    expect(mocks.track).toHaveBeenCalledWith({ event: "AccountFunded", userId: account, properties: { source: null } });
    expect(sendPushNotificationMock).toHaveBeenCalledExactlyOnceWith({
      userId: account,
      headings: t("Account assets updated"),
      contents: t("Your funds are ready to use"),
    });
    expect(setAttribute.mock.calls.filter(([attribute]) => String(attribute).startsWith("exa."))).toStrictEqual([
      ["exa.new", true],
    ]);
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

  it("captures account funding tracking errors", async () => {
    const error = new Error("tracking error");
    const network = NETWORKS.get("ETH_MAINNET");
    if (!network) throw new Error("missing mainnet");
    mocks.getCode.mockImplementationOnce(() => Promise.resolve());
    mocks.track.mockImplementationOnce(() => {
      throw error;
    });

    await jobFinished({ ...request, chainId: network.id });

    expect(mocks.exaSend).toHaveBeenCalledOnce();
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith({
      event: "AccountFunded",
      userId: account,
      properties: { source: null },
    });
    expect(publicClient.readContract).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error" });
  });

  it("doesn't poke weth separately when eth is funded", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(1n);
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: weth, market }] as never)
      .mockResolvedValueOnce(2n);

    await jobFinished({ ...request, assets: [eth, weth] });

    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "poke account", op: "exa.poke", attributes: { account, asset: eth } },
      expect.objectContaining({ address: account, functionName: "pokeETH" }),
      { ignore: ["NoBalance()"] },
    );
  });

  it("removes weth from activity retries when eth is funded", async () => {
    const updateData = vi.spyOn(QueueJob.prototype, "updateData");
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(1n);
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: weth, market }] as never)
      .mockResolvedValueOnce(2n);

    await jobFinished({ ...request, assets: [eth, weth], origin: "activity" });

    expect(updateData).toHaveBeenCalledExactlyOnceWith({ ...request, assets: [], origin: "activity" });
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "poke account", op: "exa.poke", attributes: { account, asset: eth } },
      expect.objectContaining({ address: account, functionName: "pokeETH" }),
      { ignore: ["NoBalance()"] },
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("treats ignored no balance receipts as idempotent success", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(2n);
    mocks.exaSend.mockImplementationOnce(() => Promise.resolve());

    await jobFinished({ ...request, assets: [token] });

    expect(mocks.exaSend).toHaveBeenCalledOnce();
    expect(mocks.track).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures notification errors without retrying", async () => {
    const error = new Error("notification error");
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(2n);
    sendPushNotificationMock.mockRejectedValueOnce(error);

    await jobFinished({ ...request, assets: [token] });

    expect(mocks.exaSend).toHaveBeenCalledOnce();
    expect(sendPushNotificationMock).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error" });
  });

  it("queues credit after activity pokes", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(2n);
    const job = await jobFinished({ ...request, assets: [token], origin: "activity" });

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
    await credit.remove();
  });

  it("retries activity when credit cannot be queued", async () => {
    const error = new Error("credit unavailable");
    const add = queue.add.bind(queue);
    vi.spyOn(Queue.prototype, "add").mockImplementation((jobName: string, data: unknown, options?: JobsOptions) => {
      if (jobName === "credit") return Promise.reject(error);
      return add(jobName as "poke", data as Poke, options);
    });
    vi.mocked(publicClient.readContract).mockImplementation(
      ({ functionName }) => Promise.resolve(functionName === "assets" ? [{ asset: token, market }] : 2n) as never,
    );

    await expect(
      jobFinished(
        { ...request, assets: [token], origin: "activity" },
        { attempts: 2, backoff: { type: "fixed", delay: 1 } },
      ),
    ).rejects.toThrow("credit unavailable");

    expect(mocks.exaSend).toHaveBeenCalledOnce();
    expect(publicClient.readContract).toHaveBeenCalledTimes(3);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 2, id: `${account}-${token}` },
      fingerprint: ["{{ default }}", "unknown"],
      level: "error",
      tags: { queue: "poke", job: "poke" },
    });
  });

  it("treats empty balances as an idempotent success", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(0n);

    await jobFinished(request);

    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("retries activity until its balance is visible", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(2n);

    await jobFinished(
      { ...request, assets: [token], origin: "activity" },
      { attempts: 2, backoff: { type: "fixed", delay: 1 } },
    );

    expect(mocks.exaSend).toHaveBeenCalledOnce();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("retries only activity assets that remain pending", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([
        { asset: token, market },
        { asset: token2, market: market2 },
      ] as never)
      .mockResolvedValueOnce(2n)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce([
        { asset: token, market },
        { asset: token2, market: market2 },
      ] as never)
      .mockResolvedValueOnce(2n);

    await jobFinished(
      { ...request, assets: [token, token2], origin: "activity" },
      { attempts: 2, backoff: { type: "fixed", delay: 1 } },
    );

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(mocks.exaSend).toHaveBeenNthCalledWith(
      1,
      { name: "poke account", op: "exa.poke", attributes: { account, asset: token } },
      expect.objectContaining({ address: account, args: [market], functionName: "poke" }),
      { ignore: ["NoBalance()"] },
    );
    expect(mocks.exaSend).toHaveBeenNthCalledWith(
      2,
      { name: "poke account", op: "exa.poke", attributes: { account, asset: token2 } },
      expect.objectContaining({ address: account, args: [market2], functionName: "poke" }),
      { ignore: ["NoBalance()"] },
    );
  });

  it("captures exhausted activity as a no balance warning", async () => {
    const setUser = await spyScopeSetUser();
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(0n);

    await expect(
      jobFinished({ ...request, assets: [token], origin: "activity" }, { removeOnFail: false }),
    ).rejects.toThrow("NoBalance()");

    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState(`${account}-${token}`)).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(`${account}-${token}`);
    expect(job.failedReason).toBe("NoBalance()");
    expect(job.attemptsMade).toBe(1);
    expect(job.stacktrace).toHaveLength(1);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "NoBalance()" }), {
      extra: { account, attempts: 1, id: `${account}-${token}` },
      fingerprint: ["{{ default }}", "NoBalance"],
      level: "warning",
      tags: { queue: "poke", job: "poke" },
    });
    await job.remove();
  });

  it("deploys without poking on other chains", async () => {
    const network = NETWORKS.get("ETH_MAINNET");
    if (!network) throw new Error("missing mainnet");
    mocks.getCode.mockImplementationOnce(() => Promise.resolve());

    await jobFinished({ ...request, chainId: network.id });

    expect(mocks.wallet).toHaveBeenCalledExactlyOnceWith(poker, network);
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "create account", op: "exa.account", attributes: { account } },
      expect.objectContaining({ address: factory, functionName: "createAccount" }),
      { fees: "auto" },
    );
    expect(publicClient.readContract).not.toHaveBeenCalled();
  });

  it("deploys activity accounts funded with unsupported assets", async () => {
    mocks.getCode.mockImplementationOnce(() => Promise.resolve());
    vi.mocked(publicClient.readContract).mockResolvedValueOnce([{ asset: token, market }] as never);

    await jobFinished({ ...request, assets: [unknownAsset], origin: "activity" });

    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "create account", op: "exa.account", attributes: { account } },
      expect.objectContaining({ address: factory, functionName: "createAccount" }),
      {},
    );
    expect(mocks.track).toHaveBeenCalledWith({ event: "AccountFunded", userId: account, properties: { source: null } });
  });

  it("retries transaction failures", async () => {
    vi.mocked(publicClient.readContract).mockImplementation(
      ({ functionName }) => Promise.resolve(functionName === "assets" ? [{ asset: token, market }] : 2n) as never,
    );
    mocks.exaSend.mockRejectedValueOnce(new Error("rpc unavailable")).mockResolvedValueOnce({ status: "success" });

    await jobFinished({ ...request, assets: [token] }, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures terminal failures", async () => {
    const error = new Error("poke failed");
    const setUser = await spyScopeSetUser();
    vi.mocked(publicClient.readContract).mockImplementation(
      ({ functionName }) => Promise.resolve(functionName === "assets" ? [{ asset: token, market }] : 2n) as never,
    );
    mocks.exaSend.mockRejectedValue(error);

    await expect(
      jobFinished(
        { ...request, assets: [token] },
        { attempts: 2, backoff: { type: "fixed", delay: 1 }, removeOnFail: false },
      ),
    ).rejects.toThrow("poke failed");

    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState(`${account}-${token}`)).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(`${account}-${token}`);
    expect(job.failedReason).toBe("poke failed");
    expect(job.attemptsMade).toBe(2);
    expect(job.stacktrace).toHaveLength(2);
    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 2, id: `${account}-${token}` },
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
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(2n);
    mocks.exaSend.mockRejectedValueOnce(error);

    const setUser = await spyScopeSetUser();

    await expect(jobFinished({ ...request, assets: [token] })).rejects.toThrow("test");

    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 1, id: `${account}-${token}` },
      fingerprint: ["{{ default }}", "Unauthorized"],
      level: "error",
      tags: { queue: "poke", job: "poke" },
    });
  });

  it("continues sentry traces", async () => {
    await jobFinished(request, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

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

  it("closes resources once", async () => {
    await worker.close();
    await worker.close();

    expect(mocks.closeSegment).toHaveBeenCalledOnce();
  });
});
