import "../mocks/deployments";
import "../mocks/onesignal";
import "../mocks/sentry";

import { DefaultApi } from "@onesignal/node-onesignal";
import { captureException, continueTrace, startSpan } from "@sentry/node";
import { Queue } from "bullmq";
import { parse } from "valibot";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult } from "viem";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import chain, { wethAddress } from "@exactly/common/generated/chain";
import stack from "@exactly/common/stack";
import { Address } from "@exactly/common/validation";

import t from "../../i18n";
import { NETWORKS } from "../../utils/alchemy";
import * as onesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import { queue as connection } from "../../utils/redis";
import { close as closeQueue, enqueue } from "../../workers/poke/queue";
import { close, start } from "../../workers/poke/worker";

import type { Job as Credit } from "../../workers/credit/job";
import type { Job as Poke } from "../../workers/poke/job";
import type { Job, JobsOptions } from "bullmq";

const account = parse(Address, "0xb12057309bdDd6e071d5AAF9714C5f15E02441D6");
const eth = parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const factory = parse(Address, "0x1234567890123456789012345678901234567890");
const market = parse(Address, "0xafc70edeb980d345da3c76786d9689d41804b521");
const market2 = parse(Address, "0x1111111111111111111111111111111111111111");
const token = parse(Address, "0x9876543210987654321098765432109876543210");
const token2 = parse(Address, "0x2222222222222222222222222222222222222222");
const unknownAsset = parse(Address, "0x3333333333333333333333333333333333333333");
const weth = parse(Address, wethAddress);
const request = {
  account,
  chainId: chain.id,
  factory,
  origin: "allow",
  publicKey: "0x1234",
  source: null,
} as const;
const mocks = vi.hoisted(() => ({
  closeSegment: vi.fn(),
  decodePublicKey: vi.fn(),
  exaSend: vi.fn(),
  getCode: vi.fn(),
  getWallet: vi.fn(),
  segmentOn: vi.fn(),
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
vi.mock("../../utils/wallet", () => ({ getWallet: mocks.getWallet }));
vi.mock("../../workers/credit/job", async (importOriginal) => ({
  ...(await importOriginal()),
  name: "poke-credit",
}));

const credits = new Queue<Credit, void, "poke-credit">("poke-credit", { connection });
const producer = new Queue<Poke, void, "poke">("poke", { connection });
let worker: Awaited<ReturnType<typeof start>>;

function done(
  poke: Parameters<typeof enqueue>[0],
  options?: JobsOptions,
  trace?: { sentryBaggage?: string; sentryTrace?: string },
) {
  return new Promise<Job<Poke>>((resolve, reject) => {
    const completed = (job: Job<Poke>) => {
      if (job.data.account !== poke.account) return;
      cleanup();
      resolve(job);
    };
    const failed = (job: Job<Poke> | undefined, error: Error) => {
      if (job?.data.account !== poke.account) return;
      if (job.attemptsMade < (options?.attempts ?? 1)) return;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off("completed", completed);
      worker.off("failed", failed);
    };
    worker.on("completed", completed);
    worker.on("failed", failed);
    producer
      .add("poke", { ...poke, ...trace }, { attempts: 1, removeOnComplete: true, removeOnFail: true, ...options })
      .catch((error: unknown) => {
        cleanup();
        reject(error instanceof Error ? error : new Error("queue add failed", { cause: error }));
      });
  });
}

function queued(poke: Parameters<typeof enqueue>[0]) {
  return new Promise<void>((resolve, reject) => {
    const completed = (job: Job<Poke>) => {
      if (job.data.account !== poke.account) return;
      cleanup();
      resolve();
    };
    const failed = (job: Job<Poke> | undefined, error: Error) => {
      if (job?.data.account !== poke.account) return;
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off("completed", completed);
      worker.off("failed", failed);
    };
    worker.on("completed", completed);
    worker.on("failed", failed);
    enqueue(poke).catch((error: unknown) => {
      cleanup();
      reject(error instanceof Error ? error : new Error("queue add failed", { cause: error }));
    });
  });
}

beforeEach(async () => {
  vi.restoreAllMocks();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("missing redis url");
  worker = start({ onesignalKey: "onesignal", redisUrl, segmentKey: "segment" });
  mocks.closeSegment.mockReset().mockImplementation(() => Promise.resolve());
  mocks.decodePublicKey.mockReset().mockReturnValue({ x: "0x01", y: "0x02" });
  mocks.exaSend.mockReset().mockResolvedValue({ status: "success" });
  mocks.getCode.mockReset().mockResolvedValue("0x01");
  mocks.getWallet.mockReset().mockResolvedValue({ exaSend: mocks.exaSend, getCode: mocks.getCode });
  mocks.segmentOn.mockReset();
  mocks.track.mockReset();
  vi.spyOn(onesignal, "sendPushNotification").mockResolvedValue({} as never);
  vi.spyOn(publicClient, "getBalance").mockResolvedValue(0n);
  vi.spyOn(publicClient, "readContract").mockResolvedValue([] as never);
  vi.clearAllMocks();
  await credits.drain(true);
  await credits.clean(0, 1000, "completed");
  await credits.clean(0, 1000, "failed");
  await producer.drain(true);
  await producer.clean(0, 1000, "completed");
  await producer.clean(0, 1000, "failed");
});
afterAll(async () => {
  await Promise.all([credits.close(), producer.close(), closeQueue(), close()]);
});

describe("poke queue", () => {
  it("publishes account poke jobs", async () => {
    const pending = Symbol("pending");
    const deferred = Promise.withResolvers<Awaited<ReturnType<typeof producer.add>>>();
    const add = vi.spyOn(Queue.prototype, "add").mockReturnValue(deferred.promise);
    const result = enqueue(request);

    await vi.waitFor(() => expect(add).toHaveBeenCalledOnce());
    expect(await Promise.race([result, Promise.resolve(pending)])).toBe(pending);
    deferred.resolve({ id: account, data: request } as unknown as Awaited<ReturnType<typeof producer.add>>);

    await expect(result).resolves.toBeUndefined();
    expect(add).toHaveBeenCalledExactlyOnceWith(
      "poke",
      expect.objectContaining({
        ...request,
        sentryBaggage: expect.any(String) as string,
        sentryTrace: expect.any(String) as string,
      }),
      { jobId: account },
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "account poke", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("includes assets in job ids", async () => {
    const add = vi
      .spyOn(Queue.prototype, "add")
      .mockResolvedValueOnce({ id: account, data: request } as unknown as Awaited<ReturnType<typeof producer.add>>);

    await enqueue({ ...request, assets: [token] });

    expect(add).toHaveBeenCalledExactlyOnceWith(
      "poke",
      expect.objectContaining({
        sentryBaggage: expect.any(String) as string,
        sentryTrace: expect.any(String) as string,
      }),
      { jobId: `${account}-${token}` },
    );
  });

  it("captures queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await expect(enqueue(request)).rejects.toThrow(error);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: "poke", job: "poke" },
      extra: { account },
    });
  });
});

describe("poke worker", () => {
  it("deploys and pokes funded accounts after allow", async () => {
    mocks.getCode.mockImplementationOnce(() => Promise.resolve());
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(1n);
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(2n);

    await queued(request);

    expect(mocks.getWallet).toHaveBeenCalledExactlyOnceWith(`${stack}-poker`, NETWORKS.get("ANVIL"));
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
    expect(onesignal.sendPushNotification).toHaveBeenCalledWith(
      {
        userId: account,
        headings: t("Account assets updated"),
        contents: t("Your funds are ready to use"),
      },
      expect.any(DefaultApi),
    );
  });

  it("doesn't poke weth separately when eth is funded", async () => {
    vi.mocked(publicClient.getBalance).mockResolvedValueOnce(1n);
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: weth, market }] as never)
      .mockResolvedValueOnce(2n);

    await done({ ...request, assets: [eth, weth] });

    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      { name: "poke account", op: "exa.poke", attributes: { account, asset: eth } },
      expect.objectContaining({ address: account, functionName: "pokeETH" }),
      { ignore: ["NoBalance()"] },
    );
  });

  it("queues credit after activity pokes", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(2n);
    const job = await done({ ...request, assets: [token], origin: "activity" });
    const id = job.id;
    expect(id).toBeDefined();
    if (!id) throw new Error("missing job id");

    await expect(credits.getJob(`poke-${id}`)).resolves.toMatchObject({
      data: { account },
      name: "poke-credit",
    });
  });

  it("treats empty balances as an idempotent success", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(0n);

    await done(request);

    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(onesignal.sendPushNotification).not.toHaveBeenCalled();
  });

  it("retries activity until its balance is visible", async () => {
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(2n);

    await done(
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

    await done(
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
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(0n);

    await expect(done({ ...request, assets: [token], origin: "activity" })).rejects.toThrow("NoBalance()");

    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "NoBalance()" }), {
      extra: { account, attempts: expect.any(Number) as number, id: expect.any(String) as string },
      fingerprint: ["{{ default }}", "NoBalance"],
      level: "warning",
      tags: { queue: "poke", job: "poke" },
    });
  });

  it("deploys without poking on other chains", async () => {
    const network = NETWORKS.get("ETH_MAINNET");
    if (!network) throw new Error("missing mainnet");
    mocks.getCode.mockImplementationOnce(() => Promise.resolve());

    await done({ ...request, chainId: network.id });

    expect(mocks.getWallet).toHaveBeenCalledExactlyOnceWith(`${stack}-poker`, network);
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

    await done({ ...request, assets: [unknownAsset], origin: "activity" });

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

    await done({ ...request, assets: [token] }, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures terminal failures", async () => {
    const error = new Error("poke failed");
    vi.mocked(publicClient.readContract)
      .mockResolvedValueOnce([{ asset: token, market }] as never)
      .mockResolvedValueOnce(2n);
    mocks.exaSend.mockRejectedValueOnce(error);

    await expect(done({ ...request, assets: [token] })).rejects.toThrow("poke failed");

    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { account, attempts: expect.any(Number) as number, id: expect.any(String) as string },
      fingerprint: expect.any(Array) as string[],
      level: "error",
      tags: { queue: "poke", job: "poke" },
    });
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

    await expect(done({ ...request, assets: [token] })).rejects.toThrow(error);

    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { account, attempts: expect.any(Number) as number, id: expect.any(String) as string },
      fingerprint: ["{{ default }}", "Unauthorized"],
      level: "error",
      tags: { queue: "poke", job: "poke" },
    });
  });

  it("continues sentry traces", async () => {
    await done(request, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(continueTrace).toHaveBeenCalledWith({ sentryTrace: "trace", baggage: "baggage" }, expect.any(Function));
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.emit("error", error);

    expect(captureException).toHaveBeenCalledWith(error, { level: "error", tags: { queue: "poke" } });
  });

  it("captures failed events without a job", () => {
    const error = new Error("failed event error");

    worker.emit("failed", undefined, error, "active");

    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { account: undefined, attempts: undefined, id: undefined },
      fingerprint: expect.any(Array) as string[],
      level: "error",
      tags: { queue: "poke", job: undefined },
    });
  });

  it("skips intermediate failed events", () => {
    const error = new Error("failed event error");

    worker.emit(
      "failed",
      { attemptsMade: 9, data: request, name: "poke", opts: {} } as unknown as Awaited<ReturnType<typeof producer.add>>,
      error,
      "active",
    );

    expect(captureException).not.toHaveBeenCalled();
  });
});
