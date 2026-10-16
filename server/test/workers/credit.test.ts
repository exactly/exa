import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/sentry";
import "../mocks/wallet";

import { captureException, continueTrace, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents } from "bullmq";
import { eq, inArray } from "drizzle-orm";
import { hexToBigInt, padHex, parseEther, zeroHash, type Hex } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import {
  exaAccountFactoryAbi,
  exaAccountFactoryAddress,
  exaPluginAbi,
  marketUSDCAddress,
  marketWETHAddress,
  usdcAddress,
  wethAddress,
} from "@exactly/common/generated/chain";

import database, { cards, credentials } from "../../database";
import t from "../../i18n";
import createOnesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import { bullmq } from "../../utils/redis";
import wallet from "../../utils/wallet";
import createCredit from "../../workers/credit/queue";
import creditWorker from "../../workers/credit/worker";
import { finished, tip } from "../redis";

import type { Job as Credit } from "../../workers/credit/job";
import type { Address } from "@exactly/common/validation";
import type * as sentry from "@sentry/node";
import type { JobsOptions } from "bullmq";

const account = derive("0xc12ed1");
const debit = derive("0xc12ed2");
const empty = derive("0xc12ed3");
const unknown = derive("0xc12ed4");
const holder = derive("0xc12ed5");
const keeper = wallet(privateKeyToAccount(padHex("0x69")));
const credit = createCredit(bullmq);
const onesignal = createOnesignal("onesignal");
const queue = new Queue<Credit, void, "credit">("credit", { connection: bullmq });
const events = new QueueEvents("credit", { connection: bullmq, lastEventId: await tip(bullmq, queue) });
const readContract = publicClient.readContract;
let worker: ReturnType<typeof creditWorker>;

beforeAll(async () => {
  await database.insert(credentials).values([
    { id: "credit-worker", account, factory: exaAccountFactoryAddress, publicKey: new Uint8Array() },
    { id: "credit-debit", account: debit, factory: exaAccountFactoryAddress, publicKey: new Uint8Array() },
    { id: "credit-empty", account: empty, factory: exaAccountFactoryAddress, publicKey: new Uint8Array() },
    { id: "credit-holder", account: holder, factory: exaAccountFactoryAddress, publicKey: new Uint8Array() },
  ]);
  await database.insert(cards).values([
    { id: "credit-card", credentialId: "credit-worker", lastFour: "1234" },
    { id: "credit-debit-card", credentialId: "credit-debit", lastFour: "1234" },
    { id: "credit-empty-card", credentialId: "credit-empty", lastFour: "1234" },
    { id: "credit-active", credentialId: "credit-holder", lastFour: "1111" },
    { id: "credit-deleted", credentialId: "credit-holder", lastFour: "2222", status: "DELETED" },
    { id: "credit-frozen", credentialId: "credit-holder", lastFour: "3333", status: "FROZEN" },
    { id: "credit-installments", credentialId: "credit-holder", lastFour: "4444", mode: 3 },
  ]);
  await Promise.all([
    collateralize("0xc12ed1", [wethAddress, marketWETHAddress, parseEther("1")]),
    collateralize(
      "0xc12ed2",
      [wethAddress, marketWETHAddress, parseEther("1")],
      [usdcAddress, marketUSDCAddress, 1_000_000n],
    ),
    collateralize("0xc12ed4", [wethAddress, marketWETHAddress, parseEther("1")]),
    collateralize("0xc12ed5", [wethAddress, marketWETHAddress, parseEther("1")]),
  ]);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  sendPushNotificationMock.mockResolvedValue({});
  vi.clearAllMocks();
  await database.update(cards).set({ mode: 0, status: "ACTIVE" }).where(eq(cards.credentialId, "credit-worker"));
});

afterAll(async () => {
  await database
    .delete(cards)
    .where(inArray(cards.credentialId, ["credit-worker", "credit-debit", "credit-empty", "credit-holder"]));
  await database
    .delete(credentials)
    .where(inArray(credentials.id, ["credit-worker", "credit-debit", "credit-empty", "credit-holder"]));
  await Promise.all([queue.close(), events.close(), credit.close()]);
});

describe("credit queue", () => {
  it("publishes automatic credit jobs", async () => {
    await expect(credit.enqueue(account)).resolves.toBeUndefined();

    const job = await queue.getJob(account);
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(account);
    expect(job.name).toBe("credit");
    expect(job.data).toStrictEqual({
      account,
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(job.opts).toStrictEqual({
      attempts: 10,
      backoff: { type: "exponential", delay: 1000 },
      jobId: account,
      removeOnComplete: true,
      removeOnFail: true,
    });
    await expect(job.getState()).resolves.toBe("waiting");
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "credit", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
    await job.remove();
  });

  it("propagates queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    await expect(credit.enqueue(account)).rejects.toThrow(error);

    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("credit worker", () => {
  beforeAll(async () => {
    worker = creditWorker({ bullmq, database, onesignal });
    await worker.ready;
  });

  afterAll(async () => {
    await worker.close();
  });

  it("automatically activates credit mode", async () => {
    const setAttribute = await spySpanSetAttribute(account);

    await jobFinished(account);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 1 });
    expect(sendPushNotificationMock).toHaveBeenCalledExactlyOnceWith({
      userId: account,
      headings: t("Credit mode activated"),
      contents: t("Your card is now in credit mode"),
    });
    expect(setAttribute.mock.calls.filter(([attribute]) => String(attribute).startsWith("exa."))).toStrictEqual([
      ["exa.autoCredit", true],
      ["exa.cards", ["credit-card"]],
      ["exa.mode", 1],
    ]);
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ forceTransaction: true, name: "credit worker" }),
      expect.any(Function),
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "credit", op: "queue.process" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("activates credit mode on every active or frozen debit card", async () => {
    await jobFinished(holder);

    await expect(
      database.query.cards.findMany({
        columns: { id: true, mode: true },
        where: eq(cards.credentialId, "credit-holder"),
        orderBy: cards.id,
      }),
    ).resolves.toStrictEqual([
      { id: "credit-active", mode: 1 },
      { id: "credit-deleted", mode: 0 },
      { id: "credit-frozen", mode: 1 },
      { id: "credit-installments", mode: 3 },
    ]);
    expect(sendPushNotificationMock).toHaveBeenCalledExactlyOnceWith({
      userId: holder,
      headings: t("Credit mode activated"),
      contents: t("Your card is now in credit mode", { count: 2 }),
    });
  });

  it("keeps debit mode without deposits", async () => {
    await jobFinished(empty);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-empty-card") }),
    ).resolves.toStrictEqual({ mode: 0 });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("keeps debit mode with usdc deposits", async () => {
    await jobFinished(debit);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-debit-card") }),
    ).resolves.toStrictEqual({ mode: 0 });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("does not change an existing credit mode", async () => {
    await database.update(cards).set({ mode: 1 }).where(eq(cards.id, "credit-card"));

    await jobFinished(account);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 1 });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("does not change deleted cards", async () => {
    await database.update(cards).set({ status: "DELETED" }).where(eq(cards.id, "credit-card"));

    await jobFinished(account);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 0 });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("does not change cards for unknown accounts", async () => {
    await jobFinished(unknown);

    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 0 });
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("captures notification errors without retrying", async () => {
    const error = new Error("push failed");
    const spy = vi.spyOn(publicClient, "readContract");
    sendPushNotificationMock.mockRejectedValueOnce(error);

    await jobFinished(account);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error" });
    expect(reads(spy)).toHaveLength(1);
    await expect(
      database.query.cards.findFirst({ columns: { mode: true }, where: eq(cards.id, "credit-card") }),
    ).resolves.toStrictEqual({ mode: 1 });
  });

  it("retries automatic credit failures", async () => {
    const spy = fail(new Error("rpc unavailable"), 1);

    await jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(reads(spy)).toHaveLength(2);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures persisted terminal failures", async () => {
    const error = new Error("credit failed");
    fail(error, 1);
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account, { removeOnFail: false })).rejects.toThrow("credit failed");

    await expect(queue.getJobState(account)).resolves.toBe("failed");
    const job = await queue.getJob(account);
    if (!job) throw new Error("job not found");
    expect(job.id).toBe(account);
    expect(job.failedReason).toBe("credit failed");
    expect(job.attemptsMade).toBe(1);
    expect(job.stacktrace).toHaveLength(1);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 1, id: account },
      level: "error",
      tags: { queue: "credit", job: "credit" },
    });
    await job.remove();
  });

  it("captures only terminal failed events", async () => {
    const error = new Error("credit failed");
    const spy = fail(error);
    const setUser = await spyScopeSetUser();

    await expect(jobFinished(account, { attempts: 2, backoff: { type: "fixed", delay: 1 } })).rejects.toThrow(
      "credit failed",
    );

    expect(reads(spy)).toHaveLength(2);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account, attempts: 2, id: account },
      level: "error",
      tags: { queue: "credit", job: "credit" },
    });
  });

  it("continues sentry traces", async () => {
    await jobFinished(account, undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(continueTrace).toHaveBeenCalledWith({ sentryTrace: "trace", baggage: "baggage" }, expect.any(Function));
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.queue.emit("error", error);

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error", tags: { queue: "credit" } });
  });

  it("captures failed events without a job", async () => {
    const error = new Error("failed event error");
    const setUser = await spyScopeSetUser();

    worker.queue.emit("failed", undefined, error, "active");

    expect(setUser).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { account: undefined, attempts: undefined, id: undefined },
      level: "error",
      tags: { queue: "credit", job: undefined },
    });
  });
});

async function jobFinished(
  current: Address,
  options?: JobsOptions,
  trace?: Pick<Credit, "sentryBaggage" | "sentryTrace">,
) {
  const result = finished(events, current);
  await queue.add(
    "credit",
    { account: current, ...trace },
    { attempts: 1, jobId: current, removeOnComplete: true, removeOnFail: true, ...options },
  );
  await result.catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
}

async function collateralize(owner: Hex, ...deposits: (readonly [Hex, Hex, bigint])[]) {
  const address = derive(owner);
  await keeper.exaSend(
    { name: "create account", op: "exa.account" },
    {
      address: exaAccountFactoryAddress,
      abi: exaAccountFactoryAbi,
      functionName: "createAccount",
      args: [0n, [{ x: hexToBigInt(privateKeyToAddress(padHex(owner))), y: 0n }]],
    },
  );
  for (const [asset, market, amount] of deposits) {
    await keeper.exaSend(
      { name: "mint", op: "tx.mint" },
      { address: asset, abi: mockERC20Abi, functionName: "mint", args: [address, amount] },
    );
    await keeper.exaSend(
      { name: "poke", op: "exa.poke" },
      { address, abi: exaPluginAbi, functionName: "poke", args: [market] },
    );
  }
}

function derive(owner: Hex) {
  return deriveAddress(exaAccountFactoryAddress, { x: padHex(privateKeyToAddress(padHex(owner))), y: zeroHash });
}

function fail(error: Error, times = Infinity) {
  let remaining = times;
  return vi
    .spyOn(publicClient, "readContract")
    .mockImplementation((parameters) =>
      parameters.args?.[0] === account && remaining-- > 0 ? Promise.reject(error) : readContract(parameters as never),
    );
}

function reads(spy: MockInstance<typeof publicClient.readContract>) {
  return spy.mock.calls.filter(([{ args }]) => args?.[0] === account);
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

async function spySpanSetAttribute(id: string) {
  const { startSpan: realStartSpan } = await vi.importActual<typeof sentry>("@sentry/node");
  const setAttribute = vi.fn();
  vi.mocked(startSpan).mockImplementation(((options, callback) =>
    realStartSpan(options, (span) => {
      if (options.attributes?.["messaging.message.id"] !== id) return callback(span);
      const originalSetAttribute = span.setAttribute.bind(span);
      span.setAttribute = (...args: Parameters<typeof span.setAttribute>) => {
        setAttribute(...args);
        return originalSetAttribute(...args);
      };
      return callback(span);
    })) as typeof startSpan);
  return setAttribute;
}

const mockERC20Abi = [
  {
    type: "function",
    name: "mint",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
