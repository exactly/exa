import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/sentry";
import { walletClient } from "../mocks/wallet";

import { SPAN_STATUS_OK } from "@sentry/core";
import { captureException, continueTrace, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents, Job as QueueJob } from "bullmq";
import { v5 } from "uuid";
import { parse } from "valibot";
import {
  BaseError,
  ContractFunctionRevertedError,
  createTestClient,
  encodeErrorResult,
  erc20Abi,
  http,
  padHex,
  parseEther,
  publicActions,
  walletActions,
  zeroAddress,
  zeroHash,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { moonbeamDev } from "viem/chains";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain, {
  activityChains,
  auditorAbi,
  chains,
  exaAccountFactoryAddress,
  exaPreviewerAbi,
  firewallAbi,
  marketAbi,
  marketWETHAddress,
  previewerAbi,
  previewerAddress,
  usdcAddress,
  wethAddress,
} from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import t from "../../i18n";
import createOnesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import { bullmq } from "../../utils/redis";
import createSegment from "../../utils/segment";
import wallet from "../../utils/wallet";
import createPoke from "../../workers/poke/queue";
import pokeWorker from "../../workers/poke/worker";
import anvilClient from "../anvilClient";
import { finished, tip } from "../redis";

import type { Job as Poke } from "../../workers/poke/job";
import type * as C from "@exactly/common/generated/chain";
import type * as sentry from "@sentry/node";
import type { JobsOptions } from "bullmq";
import type { EventEmitter } from "node:events";

const eth = parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const token = parse(Address, wethAddress);
const token2 = parse(Address, usdcAddress);
const unknownAsset = parse(Address, "0x3333333333333333333333333333333333333333");
const weth = parse(Address, wethAddress);
const salt = parse(Address, padHex("0x0", { size: 20 }));
const poker = privateKeyToAccount(padHex("0xb0b"));
const poke = createPoke(bullmq);
const anvil2 = activityChains.get(moonbeamDev.id);
if (!anvil2?.smartAccount) throw new Error("missing anvil2");
const anvil2Client = createTestClient({ chain: anvil2, mode: "anvil", transport: http() })
  .extend(publicActions)
  .extend(walletActions);
const anvil2Auditor = await anvil2Client.readContract({
  address: parse(Address, chains.get(moonbeamDev.id)?.exaPreviewer),
  functionName: "AUDITOR",
  abi: exaPreviewerAbi,
});
const minter = privateKeyToAccount(generatePrivateKey());
await Promise.all(
  [anvilClient, anvil2Client].map((client) => client.setBalance({ address: minter.address, value: 10n ** 20n })),
);
const allower = wallet(poker, anvil2);
const mocks = vi.hoisted(() => ({
  closeSegment: vi.fn(),
  lifiURL: vi.fn<(url: string | undefined) => string | undefined>(),
  segmentOn: vi.fn<(event: string, listener: (error: Error) => void) => void>(),
  track: vi.fn(),
}));

vi.mock("@exactly/common/generated/chain", async (importOriginal) => {
  const original = await importOriginal<typeof C>();
  return {
    ...original,
    get lifiURL() {
      return mocks.lifiURL(original.lifiURL);
    },
  };
});
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

const queue = new Queue<Poke, void, "poke">("poke", { connection: bullmq });
const events = new QueueEvents("poke", { connection: bullmq, lastEventId: await tip(bullmq, queue) });
let worker: Awaited<ReturnType<typeof pokeWorker>>;
let segmentError: ((error: Error) => void) | undefined;
let segmentEvent: string | undefined;

async function jobFinished(
  current: Parameters<ReturnType<typeof createPoke>["enqueue"]>[0],
  options?: JobsOptions,
  trace?: Pick<Poke, "sentryBaggage" | "sentryTrace">,
) {
  const id = [current.chainId, current.account, ...(current.assets ?? [])].join("-");
  const result = finished(events, id);
  const job = await queue.add(
    "poke",
    { ...current, ...trace },
    { attempts: 1, jobId: id, removeOnComplete: true, removeOnFail: true, ...options },
  );
  await result.catch(async (error: unknown) => {
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

const realFetch = globalThis.fetch;

function mockLifi(response = Response.json({ priceUSD: "100" })) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    return /^(?:https:\/\/li\.quest|http:\/\/localhost:3000\/e2e\/lifi)\/v1\//.test(url)
      ? Promise.resolve(response.clone())
      : realFetch(input, init);
  });
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

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.closeSegment.mockReset().mockImplementation(() => Promise.resolve());
  mocks.segmentOn.mockReset();
  mocks.track.mockReset();
  mocks.lifiURL.mockReset().mockImplementation((url) => url);
  mockLifi();
  sendPushNotificationMock.mockResolvedValue({});
  ({ account, request } = createRequest());
  const waitForReceipt = publicClient.waitForTransactionReceipt;
  vi.spyOn(publicClient, "waitForTransactionReceipt").mockImplementation((parameters) =>
    waitForReceipt({ ...parameters, checkReplacement: false, pollingInterval: 10 }),
  );
});
afterAll(async () => {
  await Promise.all([events.close(), queue.close(), poke.close()]);
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
      removeOnFail: true,
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

  it("rejects known chains without smart accounts before creating a wallet", async () => {
    const anvil = activityChains.get(chain.id);
    if (!anvil) throw new Error("missing anvil");
    vi.spyOn(activityChains, "get").mockReturnValue({ ...anvil, smartAccount: undefined });
    const readContract = vi.spyOn(publicClient, "readContract");
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(request)).rejects.toThrow(`unsupported chain ${chain.id}`);

    expect(wallet).not.toHaveBeenCalled();
    expect(readContract).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: `unsupported chain ${chain.id}` }),
      {
        extra: { account, attempts: 1, id: `${chain.id}-${account}` },
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
    const add = vi.spyOn(Queue.prototype, "add");

    const job = await jobFinished(request);

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(await getWETHMarket(account)).toMatchObject({ deposited: deposit, isCollateral: true });
    expect(credits(add)).toStrictEqual([
      ["credit", expect.objectContaining({ account }), { jobId: `poke-${job.id}-1` }],
    ]);
    expect(wallet).toHaveBeenCalledExactlyOnceWith(poker, activityChains.get(chain.id));
    expect(mocks.track).toHaveBeenCalledWith({ event: "AccountFunded", userId: account, properties: { source: null } });
    expect(sendPushNotificationMock).toHaveBeenCalledExactlyOnceWith({
      userId: account,
      headings: t("Account assets updated"),
      contents: t("Your funds are ready to use"),
      idempotencyKey: v5(`https://exact.ly/poke/${job.id}/${job.timestamp}`, v5.URL),
      topic: "assets",
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
      expect(await getWETHMarket(current)).toMatchObject({ deposited: deposit, isCollateral: true });
    }
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures account funding tracking errors", async () => {
    const error = new Error("tracking error");
    mocks.track.mockImplementationOnce(() => {
      throw error;
    });

    await jobFinished({ ...request, assets: [unknownAsset], origin: "activity" });

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
      deposited: ethDeposit + wethDeposit,
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
      deposited: ethDeposit + wethDeposit,
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

    expect(await getWETHMarket(account)).toMatchObject({ deposited: 0n, isCollateral: false });
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

    expect(await getWETHMarket(account)).toMatchObject({ deposited: deposit, isCollateral: true });
    expect(sendPushNotificationMock).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error" });
  });

  it("queues credit after pokes", async () => {
    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });
    const add = vi.spyOn(Queue.prototype, "add");
    const job = await jobFinished({ ...request, assets: [eth], origin: "activity" });

    expect(credits(add)).toStrictEqual([
      [
        "credit",
        { account, sentryBaggage: expect.any(String) as string, sentryTrace: expect.any(String) as string },
        { jobId: `poke-${job.id}-1` },
      ],
    ]);
    expect(await getWETHMarket(account)).toMatchObject({ deposited: deposit, isCollateral: true });
  });

  it("drops credit when it cannot be queued", async () => {
    const deposit = parseEther("5");
    const add = queue.add.bind(queue);
    await anvilClient.setBalance({ address: account, value: deposit });
    const spy = vi
      .spyOn(Queue.prototype, "add")
      .mockImplementation((jobName: string, data: unknown, options?: JobsOptions) => {
        if (jobName === "credit") return Promise.reject(new Error("credit unavailable"));
        return add(jobName as "poke", data as Poke, options);
      });

    const job = await jobFinished(
      { ...request, assets: [eth], origin: "activity" },
      { attempts: 2, backoff: { type: "fixed", delay: 1 } },
    );

    expect(await getWETHMarket(account)).toMatchObject({ deposited: deposit, isCollateral: true });
    expect(credits(spy)).toStrictEqual([
      ["credit", expect.objectContaining({ account }), { jobId: `poke-${job.id}-1` }],
    ]);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips the deploy of allowed accounts without balance", async () => {
    await jobFinished({ ...request, assets: [token] });

    expect(await publicClient.getCode({ address: account })).toBeUndefined();
    expect(mocks.track).not.toHaveBeenCalled();
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

    expect(await getWETHMarket(account)).toMatchObject({ deposited: deposit, isCollateral: true });
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
    expect(await getMarket(account, token)).toMatchObject({ deposited: wethDeposit, isCollateral: true });
    expect(await getMarket(account, token2)).toMatchObject({ deposited: usdcDeposit, isCollateral: true });
  });

  it("queues credit after each partial activity poke", async () => {
    const readContract = publicClient.readContract;
    let hidden = true;
    await mint(token, account, parseEther("2"));
    vi.spyOn(publicClient, "readContract").mockImplementation(async (parameters) => {
      if (hidden && parameters.functionName === "balanceOf" && parameters.address === token2) {
        hidden = false;
        await mint(token2, account, 2_000_000n);
        return 0n as never;
      }
      return readContract(parameters as never);
    });
    const add = vi.spyOn(Queue.prototype, "add");

    const job = await jobFinished(
      { ...request, assets: [token, token2], origin: "activity" },
      { attempts: 2, backoff: { type: "fixed", delay: 1 } },
    );

    expect(credits(add)).toStrictEqual([
      ["credit", expect.objectContaining({ account }), { jobId: `poke-${job.id}-1` }],
      ["credit", expect.objectContaining({ account }), { jobId: `poke-${job.id}-2` }],
    ]);
    expect(await getMarket(account, token)).toMatchObject({ isCollateral: true });
    expect(await getMarket(account, token2)).toMatchObject({ isCollateral: true });
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
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "NoBalance()" }), {
      extra: { account, attempts: 1, id },
      fingerprint: ["{{ default }}", "NoBalance"],
      level: "warning",
      tags: { queue: "poke", job: "poke" },
    });
    await job.remove();
  });

  it("deploys and pokes other chains without queuing credit", async () => {
    const deposit = parseEther("5");
    await anvil2Client.setBalance({ address: account, value: deposit });
    await allow(account);
    const readContract = vi.spyOn(publicClient, "readContract");
    const add = vi.spyOn(Queue.prototype, "add");

    await jobFinished({ ...request, chainId: moonbeamDev.id });

    expect(readContract).not.toHaveBeenCalled();
    await expect(getAnvil2Market(account, marketWETHAddress)).resolves.toStrictEqual({
      floatingDepositAssets: deposit,
      isCollateral: true,
    });
    expect(wallet).toHaveBeenCalledExactlyOnceWith(poker, anvil2);
    expect(credits(add)).toStrictEqual([]);
    expect(sendPushNotificationMock).toHaveBeenCalledOnce();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("deploys without poking on networks without the protocol", async () => {
    await anvilClient.setBalance({ address: account, value: parseEther("5") });
    vi.spyOn(chains, "get").mockReturnValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- no previewer
    const readContract = vi.spyOn(publicClient, "readContract");
    const add = vi.spyOn(Queue.prototype, "add");

    await jobFinished({ ...request, origin: "activity" });

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(readContract).not.toHaveBeenCalled();
    expect(await getWETHMarket(account)).toMatchObject({ floatingDepositAssets: 0n });
    expect(credits(add)).toStrictEqual([]);
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips accounts the firewall has not allowed", async () => {
    await anvil2Client.setBalance({ address: account, value: parseEther("5") });
    const add = vi.spyOn(Queue.prototype, "add");

    await jobFinished({ ...request, chainId: moonbeamDev.id, origin: "activity" });

    expect(await anvil2Client.getCode({ address: account })).toBeDefined();
    await expect(getAnvil2Market(account, marketWETHAddress)).resolves.toStrictEqual({
      floatingDepositAssets: 0n,
      isCollateral: false,
    });
    expect(credits(add)).toStrictEqual([]);
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("pokes the remaining assets when a market is frozen", async () => {
    const deposit = parseEther("2");
    const frozen = await anvil2Client
      .readContract({ address: anvil2Auditor, functionName: "allMarkets", abi: auditorAbi })
      .then(async (markets) => {
        for (const market of markets) {
          if (await anvil2Client.readContract({ address: market, functionName: "isFrozen", abi: marketAbi })) {
            return market;
          }
        }
        throw new Error("missing frozen market");
      });
    const asset = parse(
      Address,
      await anvil2Client.readContract({ address: frozen, functionName: "asset", abi: marketAbi }),
    );
    await allow(account);
    await mint(asset, account, 2_000_000n, anvil2Client);
    await mint(token, account, deposit, anvil2Client);
    const add = vi.spyOn(Queue.prototype, "add");

    await jobFinished({ ...request, assets: [asset, token], chainId: moonbeamDev.id, origin: "activity" });

    await expect(getAnvil2Market(account, frozen)).resolves.toStrictEqual({
      floatingDepositAssets: 0n,
      isCollateral: false,
    });
    await expect(getAnvil2Market(account, marketWETHAddress)).resolves.toStrictEqual({
      floatingDepositAssets: deposit,
      isCollateral: true,
    });
    expect(credits(add)).toStrictEqual([]);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("delays deploys on other chains until gas is affordable", async () => {
    const network = activityChains.get(chain.id);
    if (!network) throw new Error("missing anvil");
    vi.spyOn(chains, "get").mockReturnValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- no previewer
    const id = `${network.id}-${account}`;
    const keeper = walletClient.account.address;
    const funds = await publicClient.getBalance({ address: keeper });
    const chainId = chain.id;
    const { startSpan: realStartSpan } = await vi.importActual<typeof sentry>("@sentry/node");
    const spans: { attributes: Record<string, unknown>; name: string; op?: string; status: unknown[] }[] = [];
    vi.mocked(startSpan).mockImplementation(((options, callback) =>
      realStartSpan(options, (span) => {
        const record = {
          attributes: {} as Record<string, unknown>,
          name: options.name,
          op: options.op,
          status: [] as unknown[],
        };
        if (options.name === "poke worker" || options.op === "queue.process") spans.push(record);
        const setAttribute = span.setAttribute.bind(span);
        span.setAttribute = (key, value) => {
          record.attributes[key] = value;
          return setAttribute(key, value);
        };
        const setStatus = span.setStatus.bind(span);
        span.setStatus = (status) => {
          record.status.push(status);
          return setStatus(status);
        };
        return callback(span);
      })) as typeof startSpan);
    Object.assign(chain, { id: 1 });

    function delayed() {
      return new Promise<void>((resolve) => {
        const emitter: EventEmitter = events;
        emitter.on("delayed", function listener({ jobId }: { jobId: string }) {
          if (jobId !== id) return;
          emitter.off("delayed", listener);
          resolve();
        });
      });
    }

    let delayedAt: number | undefined;
    try {
      await anvilClient.setBalance({ address: keeper, value: 1n });
      const first = delayed();
      await poke.enqueue({ ...request, chainId: network.id, origin: "activity" });
      const job = await queue.getJob(id);
      if (!job) throw new Error("job not found");
      await first;

      await expect(queue.getJobState(id)).resolves.toBe("delayed");
      expect(await publicClient.getCode({ address: account })).toBeUndefined();
      const pending = await queue.getJob(id);
      delayedAt = pending?.data.delayedAt;
      expect(delayedAt).toBeTypeOf("number");
      expect(pending?.data.unaffordable).toBe(true);

      const second = delayed();
      await job.promote();
      await second;

      await expect(queue.getJobState(id)).resolves.toBe("delayed");
      const current = await queue.getJob(id);
      expect(current?.data.delayedAt).toBe(delayedAt);
      expect(current?.attemptsMade).toBe(0);
      expect(mocks.track).not.toHaveBeenCalled();

      await anvilClient.setBalance({ address: keeper, value: funds });
      const result = finished(events, id);
      await job.promote();
      await result;
    } finally {
      Object.assign(chain, { id: chainId });
      await anvilClient.setBalance({ address: keeper, value: funds });
    }

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("unaffordable deploy"), {
      extra: { account, balance: "1", cost: expect.stringMatching(/^\d+$/), id }, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      fingerprint: ["{{ default }}", String(network.id)],
      level: "warning",
      tags: { queue: "poke", job: "poke" },
    });
    const delayedSpans = [
      { attributes: {}, name: "poke worker", op: undefined, status: [{ code: SPAN_STATUS_OK }] },
      {
        attributes: { "exa.delayed": true, "exa.new": true },
        name: "poke",
        op: "queue.process",
        status: [{ code: SPAN_STATUS_OK }],
      },
    ];
    expect(spans).toStrictEqual([
      ...delayedSpans,
      ...delayedSpans,
      { attributes: {}, name: "poke worker", op: undefined, status: [{ code: SPAN_STATUS_OK }] },
      { attributes: { "exa.new": true }, name: "poke", op: "queue.process", status: [{ code: SPAN_STATUS_OK }] },
    ]);
    expect(mocks.track).toHaveBeenCalledExactlyOnceWith({
      event: "AccountFunded",
      userId: account,
      properties: { source: null },
    });
  });

  it("delays deploys on other chains while gas costs more than the ceiling", async () => {
    const network = activityChains.get(chain.id);
    if (!network) throw new Error("missing anvil");
    vi.spyOn(chains, "get").mockReturnValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- no previewer
    const id = `${network.id}-${account}`;
    const chainId = chain.id;
    const setAttribute = await spySpanSetAttribute();
    const fetch = mockLifi(Response.json({ priceUSD: "1000000" }));
    Object.assign(chain, { testnet: false });
    Object.assign(chain, { id: 1 });

    try {
      const delayed = new Promise<void>((resolve) => {
        const emitter: EventEmitter = events;
        emitter.on("delayed", function listener({ jobId }: { jobId: string }) {
          if (jobId !== id) return;
          emitter.off("delayed", listener);
          resolve();
        });
      });
      await poke.enqueue({ ...request, chainId: network.id, origin: "activity" });
      const job = await queue.getJob(id);
      if (!job) throw new Error("job not found");
      await delayed;

      await expect(queue.getJobState(id)).resolves.toBe("delayed");
      expect(await publicClient.getCode({ address: account })).toBeUndefined();
      expect(fetch).toHaveBeenCalledWith(
        `http://localhost:3000/e2e/lifi/v1/token?chain=${network.id}&token=${zeroAddress}`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      );
      expect(setAttribute).toHaveBeenCalledWith("exa.delayed", true);
      const pending = await queue.getJob(id);
      expect(pending?.data.delayedAt).toBeTypeOf("number");
      expect(pending?.data.unaffordable).toBeUndefined();
      expect(pending?.data.stuck).toBeUndefined();
      expect(captureException).not.toHaveBeenCalled();
      expect(mocks.track).not.toHaveBeenCalled();

      mockLifi();
      const result = finished(events, id);
      await job.promote();
      await result;
    } finally {
      Object.assign(chain, { testnet: true });
      Object.assign(chain, { id: chainId });
    }

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("deploys on testnet stacks without pricing", async () => {
    const network = activityChains.get(chain.id);
    if (!network) throw new Error("missing anvil");
    vi.spyOn(chains, "get").mockReturnValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- no previewer
    const chainId = chain.id;
    const fetch = mockLifi(new Response(null, { status: 500 }));
    Object.assign(chain, { id: 1 });

    try {
      await jobFinished({ ...request, chainId: network.id, origin: "activity" });
    } finally {
      Object.assign(chain, { id: chainId });
    }

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/v1/token"), expect.anything());
    expect(captureException).not.toHaveBeenCalled();
  });

  it("prices other chains on li.quest when codegen has no lifi url", async () => {
    const network = activityChains.get(chain.id);
    if (!network) throw new Error("missing anvil");
    vi.spyOn(chains, "get").mockReturnValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- no previewer
    const chainId = chain.id;
    mocks.lifiURL.mockReset();
    const fetch = mockLifi();
    Object.assign(chain, { testnet: false });
    Object.assign(chain, { id: 1 });

    try {
      await jobFinished({ ...request, chainId: network.id, origin: "activity" });
    } finally {
      Object.assign(chain, { testnet: true });
      Object.assign(chain, { id: chainId });
    }

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(fetch).toHaveBeenCalledWith(
      `https://li.quest/v1/token?chain=${network.id}&token=${zeroAddress}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    );
  });

  it("deploys on other chains when no native price is known", async () => {
    const network = activityChains.get(chain.id);
    if (!network) throw new Error("missing anvil");
    vi.spyOn(chains, "get").mockReturnValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- no previewer
    const id = `${network.id}-${account}`;
    const chainId = chain.id;
    const keeper = walletClient.account.address;
    const funds = await publicClient.getBalance({ address: keeper });
    await worker.close();
    worker = pokeWorker({ bullmq, onesignal, poker, segment });
    await worker.ready;
    mockLifi(new Response(null, { status: 400 }));
    Object.assign(chain, { testnet: false });
    Object.assign(chain, { id: 1 });

    function delayed() {
      return new Promise<void>((resolve) => {
        const emitter: EventEmitter = events;
        emitter.on("delayed", function listener({ jobId }: { jobId: string }) {
          if (jobId !== id) return;
          emitter.off("delayed", listener);
          resolve();
        });
      });
    }

    const delayedAt = Date.now() - 12 * 60 * 60_000;
    try {
      await anvilClient.setBalance({ address: keeper, value: 1n });
      const first = delayed();
      await poke.enqueue({ ...request, chainId: network.id, origin: "activity" });
      const job = await queue.getJob(id);
      if (!job) throw new Error("job not found");
      await first;

      const pending = await queue.getJob(id);
      if (!pending) throw new Error("job not found");
      await pending.updateData({ ...pending.data, delayedAt });
      const second = delayed();
      await job.promote();
      await second;
      expect(captureException).toHaveBeenLastCalledWith(new Error("stuck deploy"), {
        extra: { account, delayedAt, gasPrice: expect.stringMatching(/^\d+$/), id, price: undefined }, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        fingerprint: ["{{ default }}", String(network.id)],
        level: "warning",
        tags: { queue: "poke", job: "poke" },
      });

      await anvilClient.setBalance({ address: keeper, value: funds });
      const result = finished(events, id);
      await job.promote();
      await result;
    } finally {
      Object.assign(chain, { testnet: true });
      Object.assign(chain, { id: chainId });
      await anvilClient.setBalance({ address: keeper, value: funds });
    }

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    const lifi = [new Error("lifi token 400"), { level: "error", tags: { queue: "poke", job: "poke" } }];
    expect(vi.mocked(captureException).mock.calls.map(([error]) => (error as Error).message)).toStrictEqual([
      "lifi token 400",
      "unaffordable deploy",
      "lifi token 400",
      "stuck deploy",
      "lifi token 400",
    ]);
    expect(captureException).toHaveBeenNthCalledWith(5, ...lifi);
  });

  it("deploys on other chains with the last native price while li.fi fails", async () => {
    const network = activityChains.get(chain.id);
    if (!network) throw new Error("missing anvil");
    vi.spyOn(chains, "get").mockReturnValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- no previewer
    const chainId = chain.id;
    const next = createRequest();
    Object.assign(chain, { testnet: false });
    Object.assign(chain, { id: 1 });

    try {
      await jobFinished({ ...request, chainId: network.id, origin: "activity" });
      mockLifi(new Response(null, { status: 500 }));
      await jobFinished({ ...next.request, chainId: network.id, origin: "activity" });
    } finally {
      Object.assign(chain, { testnet: true });
      Object.assign(chain, { id: chainId });
    }

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(await publicClient.getCode({ address: next.account })).toBeDefined();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("lifi token 500"), {
      level: "error",
      tags: { queue: "poke", job: "poke" },
    });
  });

  it("warns once when deploys stay delayed for twelve hours", async () => {
    const network = activityChains.get(chain.id);
    if (!network) throw new Error("missing anvil");
    vi.spyOn(chains, "get").mockReturnValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- no previewer
    const id = `${network.id}-${account}`;
    const chainId = chain.id;
    mockLifi(Response.json({ priceUSD: "1000000" }));
    Object.assign(chain, { testnet: false });
    Object.assign(chain, { id: 1 });

    function delayed() {
      return new Promise<void>((resolve) => {
        const emitter: EventEmitter = events;
        emitter.on("delayed", function listener({ jobId }: { jobId: string }) {
          if (jobId !== id) return;
          emitter.off("delayed", listener);
          resolve();
        });
      });
    }

    const delayedAt = Date.now() - 12 * 60 * 60_000;
    try {
      const first = delayed();
      await poke.enqueue({ ...request, chainId: network.id, origin: "activity" });
      const job = await queue.getJob(id);
      if (!job) throw new Error("job not found");
      await first;
      expect(captureException).not.toHaveBeenCalled();

      const pending = await queue.getJob(id);
      if (!pending) throw new Error("job not found");
      await pending.updateData({ ...pending.data, delayedAt });
      const second = delayed();
      await job.promote();
      await second;

      const stuck = await queue.getJob(id);
      expect(stuck?.data).toMatchObject({ delayedAt, stuck: true });
      expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("stuck deploy"), {
        extra: { account, delayedAt, gasPrice: expect.stringMatching(/^\d+$/), id, price: String(10n ** 24n) }, // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        fingerprint: ["{{ default }}", String(network.id)],
        level: "warning",
        tags: { queue: "poke", job: "poke" },
      });

      const third = delayed();
      await job.promote();
      await third;
      expect(captureException).toHaveBeenCalledOnce();

      mockLifi();
      const result = finished(events, id);
      await job.promote();
      await result;
    } finally {
      Object.assign(chain, { testnet: true });
      Object.assign(chain, { id: chainId });
    }

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("deploys activity accounts funded with unsupported assets without queuing credit", async () => {
    const add = vi.spyOn(Queue.prototype, "add");

    await jobFinished({ ...request, assets: [unknownAsset], origin: "activity" });

    expect(await publicClient.getCode({ address: account })).toBeDefined();
    expect(mocks.track).toHaveBeenCalledWith({ event: "AccountFunded", userId: account, properties: { source: null } });
    expect(credits(add)).toStrictEqual([]);
  });

  it("retries rpc failures", async () => {
    const readContract = publicClient.readContract;
    vi.spyOn(publicClient, "readContract")
      .mockRejectedValueOnce(new Error("rpc unavailable"))
      .mockImplementation((parameters) => readContract(parameters as never));

    await anvilClient.setBalance({ address: account, value: parseEther("5") });

    await jobFinished(request, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

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
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
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

    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
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
  const address = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner.address), y: zeroHash });
  return {
    account: address,
    request: {
      account: address,
      chainId: chain.id,
      factory: parse(Address, exaAccountFactoryAddress),
      origin: "allow",
      publicKey: owner.address,
      salt,
      source: null,
    } satisfies Parameters<ReturnType<typeof createPoke>["enqueue"]>[0],
  };
}

async function getMarket(address: Address, asset: Address) {
  const market = await publicClient
    .readContract({ address: previewerAddress, functionName: "exactly", abi: previewerAbi, args: [address] })
    .then((markets) => markets.find((current) => current.asset === asset));
  if (!market) return market;
  const deposits = await publicClient.getContractEvents({
    abi: marketAbi,
    eventName: "Deposit",
    address: market.market,
    args: { owner: address },
    fromBlock: 0n,
    strict: true,
  });
  const { assets, shares } = deposits.reduce(
    (total, { args }) => ({ assets: total.assets + args.assets, shares: total.shares + args.shares }),
    { assets: 0n, shares: 0n },
  );
  return { ...market, deposited: shares && (assets * market.floatingDepositShares) / shares };
}

const getWETHMarket = (address: Address) => getMarket(address, token);

async function getAnvil2Market(address: Address, market: `0x${string}`) {
  const [shares, listing, entered] = await Promise.all([
    anvil2Client.readContract({ address: market, functionName: "balanceOf", args: [address], abi: marketAbi }),
    anvil2Client.readContract({ address: anvil2Auditor, functionName: "markets", args: [market], abi: auditorAbi }),
    anvil2Client.readContract({
      address: anvil2Auditor,
      functionName: "accountMarkets",
      args: [address],
      abi: auditorAbi,
    }),
  ]);
  return {
    floatingDepositAssets: await anvil2Client.readContract({
      address: market,
      functionName: "convertToAssets",
      args: [shares],
      abi: marketAbi,
    }),
    isCollateral: (entered & (1n << BigInt(listing[2]))) !== 0n,
  };
}

async function allow(address: Address) {
  await allower.waitForTransactionReceipt({
    hash: await allower.writeContract({
      address: await anvil2Client.readContract({ address: anvil2Auditor, functionName: "firewall", abi: auditorAbi }),
      functionName: "allow",
      args: [address, true],
      abi: firewallAbi,
    }),
  });
}

async function mint(
  asset: Address,
  address: Address,
  amount: bigint,
  client: typeof anvil2Client | typeof anvilClient = anvilClient,
) {
  await client.waitForTransactionReceipt({
    hash: await client.writeContract({
      account: minter,
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
    }),
  });
}

function credits(add: MockInstance<Queue["add"]>) {
  return add.mock.calls.filter(([name]) => name === "credit");
}
