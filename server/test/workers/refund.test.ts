import sendPushNotification from "../mocks/onesignal";
import "../mocks/sardine";
import "../mocks/segment";
import "../mocks/sentry";

import { captureException, continueTrace, setUser, startSpan } from "@sentry/node";
import { Queue, QueueEvents } from "bullmq";
import { eq } from "drizzle-orm";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import {
  ContractFunctionExecutionError,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  padHex,
  parseAbi,
  toFunctionSelector,
  toHex,
  zeroHash,
  type Hex,
  type LocalAccount,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

import { refunderAbi, refunderAddress, simple7702AccountAddress } from "@exactly/common/generated/chain";
import { Address, type Hash } from "@exactly/common/validation";

import database, { cards, credentials, transactions } from "../../database";
import t, { f } from "../../i18n";
import createOnesignal from "../../utils/onesignal";
import createPanda, { signIssuerOp } from "../../utils/panda";
import { bullmq } from "../../utils/redis";
import createSardine from "../../utils/sardine";
import createSegment from "../../utils/segment";
import ServiceError from "../../utils/ServiceError";
import createRefund from "../../workers/refund/queue";
import refundWorker from "../../workers/refund/worker";
import { connect } from "../../workers/worker";
import anvilClient from "../anvilClient";

import type * as P from "../../utils/panda";
import type * as W from "../../utils/wallet";
import type { Job as Refund } from "../../workers/refund/job";
import type * as C from "@exactly/common/generated/chain";
import type { JobsOptions } from "bullmq";

const account = parse(Address, padHex("0xb0b", { size: 20 }));
const salt = Array.from({ length: 32 }, (_, index) => index);
const issuer = privateKeyToAccount(padHex("0x420"));
const refunder = privateKeyToAccount(padHex("0xfee"));
const pandaAddress = parse(Address, "0x54d02DcB38B76A67dC9368D8457D1F384B865c70");
const panda = createPanda({ key: "panda", url: "https://panda.test" });
const store = "0x600160005500";
const sardineConfig = { key: "sardine", url: "https://sardine.test" };
const redisUrl = parse(pipe(string(), nonEmpty()), env.REDIS_URL);
const onesignal = createOnesignal("onesignal");
const sardine = createSardine(sardineConfig.key, sardineConfig.url);
const segment = createSegment("segment");
const refund = createRefund(bullmq);
const queue = new Queue<Refund, void, "refund">("refund", { connection: bullmq });
const events = new QueueEvents("refund", { connection: bullmq });
const webhooks = new Map<string, unknown>();
const slot = keccak256(
  encodeAbiParameters(
    [{ type: "address" }, { type: "bytes32" }],
    [
      refunder.address,
      keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [keccak256(toHex("KEEPER_ROLE")), 0n])),
    ],
  ),
);

let worker: ReturnType<typeof refundWorker>;
let connection: ReturnType<typeof connect>;
let deployedRefunder: Hex;

afterAll(async () => {
  await Promise.all([queue.close(), events.close(), refund.close(), segment.close()]);
  await database.$client.end();
});

describe("refund queue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("publishes refund jobs", async () => {
    await refund.enqueue({ account, amount: 1000, signature: "0x1234", timestamp: 1_700_000_000 }, "wh-queue");

    const job = await queue.getJob("wh-queue");
    if (!job) throw new Error("job not found");

    expect(job.id).toBe("wh-queue");
    expect(job.name).toBe("refund");
    expect(job.data).toStrictEqual({
      account,
      amount: 1000,
      signature: "0x1234",
      timestamp: 1_700_000_000,
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(job.opts).toStrictEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      jobId: "wh-queue",
      removeOnComplete: true,
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    });
    await expect(job.getState()).resolves.toBe("waiting");
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "refund", op: "queue.publish" }),
      expect.any(Function),
    );
    expect(captureException).not.toHaveBeenCalled();
    await job.remove();
  });

  it("uses more attempts on mainnet", async () => {
    vi.resetModules();
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => {
      const original = await importOriginal<typeof C>();
      return { ...original, default: { ...original.default, testnet: false } };
    });

    try {
      const { attempts } = await import("../../workers/refund/job");

      expect(attempts).toBe(20);
    } finally {
      vi.doUnmock("@exactly/common/generated/chain");
      vi.resetModules();
    }
  });

  it("propagates queue failures", async () => {
    const error = new Error("queue error");
    vi.spyOn(Queue.prototype, "add").mockRejectedValueOnce(error);

    const result = refund.enqueue(
      { account, amount: 1000, signature: "0x1234", timestamp: 1_700_000_000 },
      "wh-queue-failure",
    );

    await expect(result).rejects.toThrow(error);
    await expect(queue.getJob("wh-queue-failure")).resolves.toBeUndefined();
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("refund worker", () => {
  beforeAll(async () => {
    const code = await anvilClient.getCode({ address: inject("Refunder") });
    if (!code) throw new Error("refunder not deployed");
    deployedRefunder = code;
    await queue.drain(true);
    await Promise.all([
      anvilClient.setBalance({ address: refunder.address, value: 10n ** 24n }),
      anvilClient.setCode({ address: refunder.address, bytecode: "0x" }),
      anvilClient.setCode({ address: pandaAddress, bytecode: store }),
      anvilClient.setCode({ address: refunderAddress, bytecode: deployedRefunder }),
      anvilClient.setStorageAt({ address: refunderAddress, index: slot, value: padHex("0x1", { size: 32 }) }),
      database.transaction(async (tx) => {
        await tx
          .insert(credentials)
          .values([{ id: "refund-cred", publicKey: new Uint8Array(), account, factory: inject("ExaAccountFactory") }]);
        await tx.insert(cards).values([{ id: "refund-card", credentialId: "refund-cred", lastFour: "1234" }]);
      }),
    ]);
    connection = connect(redisUrl);
    worker = refundWorker({
      bullmq: connection,
      database,
      onesignal,
      panda,
      refunder,
      sardine,
      segment,
    });
    await worker.ready;
    await anvilClient.setCode({ address: refunderAddress, bytecode: store });
  });

  afterAll(async () => {
    await worker.close();
    await worker.close();
    await connection.quit();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    mocks.exaSend.mockReset().mockResolvedValue(null);
    await Promise.all([
      anvilClient.setStorageAt({ address: pandaAddress, index: 0, value: padHex("0x0", { size: 32 }) }),
      anvilClient.setStorageAt({ address: refunderAddress, index: 0, value: padHex("0x0", { size: 32 }) }),
    ]);
    webhooks.clear();
    mocks.getWebhook.mockReset().mockImplementation((id) => Promise.resolve(webhooks.get(id)));
    mocks.getUser.mockReset().mockResolvedValue(user);
    mocks.getWithdrawal.mockReset().mockImplementation((amount) =>
      Promise.resolve({
        parameters: [account, account, String(amount), refunderAddress, 1_700_000_000, salt, "0x1234"],
      }),
    );
    vi.clearAllMocks();
    await queue.drain(true);
    await queue.clean(0, 1000, "completed");
    await queue.clean(0, 1000, "failed");
  });

  it("delegates the refunder on startup when needed", async () => {
    await expect(anvilClient.getDelegation({ address: refunder.address })).resolves.toBe(simple7702AccountAddress);
  });

  it("keeps an existing delegation", async () => {
    const nonce = await anvilClient.getTransactionCount({ address: refunder.address });
    await anvilClient.setCode({ address: refunderAddress, bytecode: deployedRefunder });
    const dedicated = connect(redisUrl);
    const created = refundWorker({
      bullmq: dedicated,
      database,
      onesignal,
      panda,
      refunder,
      sardine,
      segment,
    });

    try {
      await created.ready;

      await expect(anvilClient.getDelegation({ address: refunder.address })).resolves.toBe(simple7702AccountAddress);
      await expect(anvilClient.getTransactionCount({ address: refunder.address })).resolves.toBe(nonce);
    } finally {
      await anvilClient.setCode({ address: refunderAddress, bytecode: store });
      await created.close();
      await dedicated.quit();
    }
  });

  it("rejects startup without the keeper role", async () => {
    await Promise.all([
      anvilClient.setCode({ address: refunderAddress, bytecode: deployedRefunder }),
      anvilClient.setStorageAt({ address: refunderAddress, index: slot, value: padHex("0x0", { size: 32 }) }),
    ]);
    const dedicated = connect(redisUrl);
    const created = refundWorker({
      bullmq: dedicated,
      database,
      onesignal,
      panda,
      refunder,
      sardine,
      segment,
    });

    try {
      await Promise.all([
        created.queue.waitUntilReady(),
        expect(created.ready).rejects.toThrow("refunder is not keeper"),
      ]);
    } finally {
      await Promise.all([
        anvilClient.setCode({ address: refunderAddress, bytecode: store }),
        anvilClient.setStorageAt({ address: refunderAddress, index: slot, value: padHex("0x1", { size: 32 }) }),
      ]);
      await created.close();
      await dedicated.quit();
    }
  });

  it("withdraws and refunds atomically", async () => {
    const requestBody = webhook("wh-authorized", { amount: 500, authorizedAmount: 1500, status: "pending" });
    const track = vi.spyOn(segment, "track").mockReturnValue();
    const feedback = vi.spyOn(sardine, "feedback");

    await jobFinished("wh-authorized");

    expect(mocks.getWebhook).toHaveBeenCalledExactlyOnceWith("wh-authorized");
    expect(mocks.getUser).toHaveBeenCalledExactlyOnceWith("user");
    expect(mocks.getWithdrawal).toHaveBeenCalledExactlyOnceWith(1000, refunderAddress, refunder.address);
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "panda.refund", op: "panda.refund", attributes: { account } }),
      expect.objectContaining({
        address: refunder.address,
        args: [
          [
            {
              data: encodeFunctionData({
                abi: withdrawAssetAbi,
                args: [account, account, 1000n, refunderAddress, 1_700_000_000n, toHex(Buffer.from(salt)), "0x1234"],
                functionName: "withdrawAsset",
              }),
              target: pandaAddress,
              value: 0n,
            },
            {
              data: encodeFunctionData({
                abi: refunderAbi,
                args: [account, 10_000_000n, 1_700_000_000n, "0x1234"],
                functionName: "refund",
              }),
              target: refunderAddress,
              value: 0n,
            },
          ],
        ],
        functionName: "executeBatch",
      }),
      {
        ignore: expect.any(Function) as (reason: string) => boolean,
        level: false,
        onHash: expect.any(Function) as (hash: Hash) => Promise<unknown>,
      },
    );
    await expect(anvilClient.getStorageAt({ address: pandaAddress, slot: padHex("0x0", { size: 32 }) })).resolves.toBe(
      padHex("0x1", { size: 32 }),
    );
    await expect(
      anvilClient.getStorageAt({ address: refunderAddress, slot: padHex("0x0", { size: 32 }) }),
    ).resolves.toBe(padHex("0x1", { size: 32 }));
    await expect(
      database.query.transactions.findFirst({ where: eq(transactions.id, "wh-authorized") }),
    ).resolves.toStrictEqual({
      id: "wh-authorized",
      cardId: "refund-card",
      hashes: [expect.stringMatching(/^0x[0-9a-f]{64}$/) as string],
      payload: { type: "panda", bodies: [{ ...requestBody, createdAt: "2026-01-01T00:00:01.000Z" }] },
    });
    expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
      userId: account,
      headings: t("Refund processed"),
      contents: t("{{refundAmount}} USDC from {{merchantName}} have been refunded to your account", {
        refundAmount: f(10),
        merchantName: "merchant",
      }),
    });
    expect(track).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: account,
        event: "TransactionRefund",
        properties: {
          id: "wh-authorized",
          type: "partial",
          source: null,
          usdAmount: 10,
          merchant: { name: "merchant", category: undefined, city: undefined, country: "AR" },
        } as unknown,
      }),
    );
    expect(feedback).toHaveBeenCalledExactlyOnceWith({
      kind: "issuing",
      customer: { id: "refund-cred" },
      transaction: { id: "wh-authorized", amount: 5 },
      feedback: { type: "settlement", status: "settled" },
    });
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ forceTransaction: true, name: "refund worker" }),
      expect.any(Function),
    );
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "refund", op: "queue.process" }),
      expect.any(Function),
    );
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(continueTrace).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("refunds reversed authorization updates", async () => {
    await database
      .insert(transactions)
      .values([
        { id: "wh-reversed", cardId: "refund-card", hashes: [zeroHash], payload: { bodies: [], type: "panda" } },
      ]);
    const requestBody = webhook("wh-reversed", { authorizationUpdateAmount: -2000, status: "reversed" }, "updated");
    const track = vi.spyOn(segment, "track").mockReturnValue();
    const feedback = vi.spyOn(sardine, "feedback");

    await jobFinished("wh-reversed", undefined, { amount: 20_000_000 });

    expect(mocks.getWithdrawal).toHaveBeenCalledExactlyOnceWith(2000, refunderAddress, refunder.address);
    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({
        args: [
          [
            expect.objectContaining({
              data: encodeFunctionData({
                abi: withdrawAssetAbi,
                args: [account, account, 2000n, refunderAddress, 1_700_000_000n, toHex(Buffer.from(salt)), "0x1234"],
                functionName: "withdrawAsset",
              }),
            }),
            expect.objectContaining({
              data: encodeFunctionData({
                abi: refunderAbi,
                args: [account, 20_000_000n, 1_700_000_000n, "0x1234"],
                functionName: "refund",
              }),
            }),
          ],
        ],
      }),
      expect.anything(),
    );
    await expect(
      database.query.transactions.findFirst({ where: eq(transactions.id, "wh-reversed") }),
    ).resolves.toStrictEqual({
      id: "wh-reversed",
      cardId: "refund-card",
      hashes: [zeroHash, expect.stringMatching(/^0x[0-9a-f]{64}$/) as string],
      payload: { type: "panda", bodies: [{ ...requestBody, createdAt: "2026-01-01T00:00:00.000Z" }] },
    });
    expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ headings: t("Refund processed") }),
    );
    expect(track).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: "TransactionRefund",
        properties: expect.objectContaining({ id: "wh-reversed", type: "reversal", usdAmount: 20 }) as unknown,
      }),
    );
    expect(feedback).not.toHaveBeenCalled();
  });

  it("refunds negative completed spends", async () => {
    const requestBody = webhook("wh-negative", { amount: -3000, status: "completed" });
    const track = vi.spyOn(segment, "track").mockReturnValue();
    const feedback = vi.spyOn(sardine, "feedback");

    await jobFinished("wh-negative", undefined, { amount: 30_000_000 });

    expect(mocks.getWithdrawal).toHaveBeenCalledExactlyOnceWith(3000, refunderAddress, refunder.address);
    expect(mocks.exaSend).toHaveBeenCalledOnce();
    await expect(
      database.query.transactions.findFirst({ where: eq(transactions.id, "wh-negative") }),
    ).resolves.toStrictEqual(
      expect.objectContaining({
        payload: { type: "panda", bodies: [{ ...requestBody, createdAt: "2026-01-01T00:00:01.000Z" }] },
      }),
    );
    expect(track).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: "TransactionRefund",
        properties: expect.objectContaining({ id: "wh-negative", type: "refund", usdAmount: 30 }) as unknown,
      }),
    );
    expect(feedback).toHaveBeenCalledExactlyOnceWith({
      kind: "issuing",
      customer: { id: "refund-cred" },
      transaction: { id: "wh-negative" },
      feedback: { type: "settlement", status: "refund" },
    });
  });

  it("ignores spend signatures", async () => {
    const signature = await signIssuerOp({ account, amount: -10_000_000n, timestamp: 1_700_000_100 }, issuer);
    webhook("wh-signed", {
      amount: 500,
      authorizedAmount: 1500,
      signature,
      status: "pending",
      timestamp: 1_700_000_100,
    });
    const track = vi.spyOn(segment, "track").mockReturnValue();

    await jobFinished("wh-signed");

    expect(mocks.exaSend).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({
        args: [
          [
            expect.anything(),
            expect.objectContaining({
              data: encodeFunctionData({
                abi: refunderAbi,
                args: [account, 10_000_000n, 1_700_000_000n, "0x1234"],
                functionName: "refund",
              }),
            }),
          ],
        ],
      }),
      expect.anything(),
    );
    expect(sendPushNotification).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledOnce();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures notification errors", async () => {
    webhook("wh-push-error", { amount: -2000, status: "completed" });
    const error = new Error("push failed");
    sendPushNotification.mockRejectedValueOnce(error);
    const track = vi.spyOn(segment, "track").mockReturnValue();
    const feedback = vi.spyOn(sardine, "feedback");

    await jobFinished("wh-push-error", undefined, { amount: 20_000_000 });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error);
    expect(track).toHaveBeenCalledOnce();
    expect(feedback).toHaveBeenCalledOnce();
  });

  it("captures refund feedback errors", async () => {
    webhook("wh-feedback-error", { amount: -2000, status: "completed" });
    const error = new Error("feedback failed");
    vi.spyOn(sardine, "feedback").mockRejectedValueOnce(error);
    const track = vi.spyOn(segment, "track").mockReturnValue();

    await jobFinished("wh-feedback-error", undefined, { amount: 20_000_000 });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error" });
    expect(track).toHaveBeenCalledOnce();
  });

  it("captures partial feedback errors", async () => {
    webhook("wh-partial-feedback-error", { amount: 500, authorizedAmount: 1500, status: "pending" });
    const error = new Error("feedback failed");
    vi.spyOn(sardine, "feedback").mockRejectedValueOnce(error);
    const track = vi.spyOn(segment, "track").mockReturnValue();

    await jobFinished("wh-partial-feedback-error");

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error" });
    expect(track).toHaveBeenCalledOnce();
  });

  it("fails without card", async () => {
    webhook("wh-no-card", { amount: -2000, cardId: "ghost-card", status: "completed" });

    const result = jobFinished("wh-no-card", undefined, { amount: 20_000_000 });

    await expect(result).rejects.toThrow("card not found");
    await vi.waitUntil(() =>
      vi
        .mocked(captureException)
        .mock.calls.some(([captured]) => captured instanceof Error && captured.message === "card not found"),
    );
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "card not found" }), {
      level: "fatal",
      fingerprint: ["{{ default }}", "refund.exhausted", "unknown"],
      tags: { queue: "refund", job: "refund", "panda.reason": "card not found", "panda.reasonName": "Error" },
      extra: { attempts: 1, id: "wh-no-card", recipient: refunderAddress },
    });
  });

  it("fails without retries on amount mismatches", async () => {
    webhook("wh-mismatch", { amount: 500, authorizedAmount: 2500, status: "pending" });
    const track = vi.spyOn(segment, "track").mockReturnValue();

    const result = jobFinished("wh-mismatch", { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    await expect(result).rejects.toThrow("amount mismatch");
    await vi.waitUntil(() => track.mock.calls.length > 0);
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: "TransactionRejected",
        properties: expect.objectContaining({
          declinedReason: "refund:amount mismatch",
          reasonName: "UnrecoverableError",
        }) as unknown,
      }),
    );
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "amount mismatch" }), {
      level: "fatal",
      fingerprint: ["{{ default }}", "refund.exhausted", "unknown"],
      tags: {
        queue: "refund",
        job: "refund",
        "panda.reason": "amount mismatch",
        "panda.reasonName": "UnrecoverableError",
      },
      extra: { attempts: 1, id: "wh-mismatch", recipient: refunderAddress },
    });
  });

  it("fails on inactive users", async () => {
    mocks.getUser.mockResolvedValueOnce({ ...user, isActive: false });
    webhook("wh-inactive", { amount: 500, authorizedAmount: 1500, status: "pending" }, "updated");
    const track = vi.spyOn(segment, "track").mockReturnValue();

    const result = jobFinished("wh-inactive");

    await expect(result).rejects.toThrow("user is not active");
    await vi.waitUntil(() => track.mock.calls.length > 0);
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(track).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: account,
        event: "TransactionRejected",
        properties: {
          cardMode: 0,
          declinedReason: "refund:user is not active",
          id: "wh-inactive",
          reasonName: "Error",
          source: null,
          updated: true,
          usdAmount: 5,
          merchant: { name: "merchant", category: undefined, city: undefined, country: "AR" },
        } as unknown,
      }),
    );
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "user is not active" }), {
      level: "fatal",
      fingerprint: ["{{ default }}", "refund.exhausted", "unknown"],
      tags: { queue: "refund", job: "refund", "panda.reason": "user is not active", "panda.reasonName": "Error" },
      extra: { attempts: 1, id: "wh-inactive", recipient: refunderAddress },
    });
  });

  it("skips side effects on replays", async () => {
    webhook("wh-replay", { amount: 500, authorizedAmount: 1500, status: "pending" });
    const track = vi.spyOn(segment, "track").mockReturnValue();
    const feedback = vi.spyOn(sardine, "feedback");
    await anvilClient.setCode({
      address: refunderAddress,
      bytecode: `0x63${toFunctionSelector("Replay()").slice(2)}60e01b60005260046000fd`,
    });

    try {
      await jobFinished("wh-replay");
    } finally {
      await anvilClient.setCode({ address: refunderAddress, bytecode: store });
    }

    expect(mocks.exaSend).toHaveBeenCalledOnce();
    await expect(
      database.query.transactions.findFirst({ where: eq(transactions.id, "wh-replay") }),
    ).resolves.toBeUndefined();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
    expect(feedback).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("fails without retries on expired signatures", async () => {
    webhook("wh-expired", { amount: 500, authorizedAmount: 1500, status: "pending" });
    const track = vi.spyOn(segment, "track").mockReturnValue();
    await anvilClient.setCode({
      address: refunderAddress,
      bytecode: `0x63${toFunctionSelector("Expired()").slice(2)}60e01b60005260046000fd`,
    });

    const result = jobFinished("wh-expired", { attempts: 2, backoff: { type: "fixed", delay: 1 } }).finally(() =>
      anvilClient.setCode({ address: refunderAddress, bytecode: store }),
    );

    await expect(result).rejects.toThrow("Expired");
    await vi.waitUntil(() => track.mock.calls.length > 0);
    expect(mocks.exaSend).toHaveBeenCalledOnce();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: account,
        event: "TransactionRejected",
        properties: {
          cardMode: 0,
          declinedReason: "refund:Expired",
          id: "wh-expired",
          reasonName: "Expired",
          source: null,
          updated: false,
          usdAmount: 5,
          merchant: { name: "merchant", category: undefined, city: undefined, country: "AR" },
        } as unknown,
      }),
    );
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.any(ContractFunctionExecutionError), {
      level: "fatal",
      fingerprint: ["{{ default }}", "refund.exhausted", "Expired"],
      tags: { queue: "refund", job: "refund", "panda.reason": "Expired", "panda.reasonName": "Expired" },
      extra: { attempts: 1, id: "wh-expired", recipient: refunderAddress },
    });
  });

  it("retries decoded reverts", async () => {
    webhook("wh-frozen", { amount: 500, authorizedAmount: 1500, status: "pending" });
    const track = vi.spyOn(segment, "track").mockReturnValue();
    await anvilClient.setCode({
      address: refunderAddress,
      bytecode: `0x63${toFunctionSelector("MarketFrozen()").slice(2)}60e01b60005260046000fd`,
    });

    const result = jobFinished("wh-frozen", { attempts: 2, backoff: { type: "fixed", delay: 1 } }).finally(() =>
      anvilClient.setCode({ address: refunderAddress, bytecode: store }),
    );

    await expect(result).rejects.toThrow("MarketFrozen");
    await vi.waitUntil(() => track.mock.calls.length > 0);
    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(track).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: "TransactionRejected",
        properties: expect.objectContaining({
          declinedReason: "refund:MarketFrozen",
          reasonName: "MarketFrozen",
        }) as unknown,
      }),
    );
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.any(ContractFunctionExecutionError), {
      level: "fatal",
      fingerprint: ["{{ default }}", "refund.exhausted", "MarketFrozen"],
      tags: { queue: "refund", job: "refund", "panda.reason": "MarketFrozen", "panda.reasonName": "MarketFrozen" },
      extra: { attempts: 2, id: "wh-frozen", recipient: refunderAddress },
    });
  });

  it("reports panda withdrawal reverts", async () => {
    webhook("wh-custody", { amount: 500, authorizedAmount: 1500, status: "pending" });
    const selector = toFunctionSelector("Nope()");
    await anvilClient.setCode({ address: pandaAddress, bytecode: `0x63${selector.slice(2)}60e01b60005260046000fd` });

    const result = jobFinished("wh-custody").finally(() =>
      anvilClient.setCode({ address: pandaAddress, bytecode: store }),
    );

    await expect(result).rejects.toThrow(selector);
    expect(mocks.exaSend).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ functionName: "withdrawAsset" }),
      {
        level: "fatal",
        fingerprint: ["{{ default }}", "refund.exhausted", selector],
        tags: { queue: "refund", job: "refund", "panda.reason": selector, "panda.reasonName": selector },
        extra: { attempts: 1, id: "wh-custody", recipient: refunderAddress },
      },
    );
  });

  it("fails when refund amount is not found", async () => {
    webhook("wh-missing", { status: "pending" });

    const result = jobFinished("wh-missing");

    await expect(result).rejects.toThrow("refund amount not found");
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "refund amount not found" }), {
      level: "fatal",
      fingerprint: ["{{ default }}", "refund.exhausted", "unknown"],
      tags: { queue: "refund", job: "refund", "panda.reason": "refund amount not found", "panda.reasonName": "Error" },
      extra: { attempts: 1, id: "wh-missing", recipient: refunderAddress },
    });
  });

  it("fails when refund amount is not positive", async () => {
    webhook("wh-zero", { amount: 500, authorizedAmount: 500, status: "pending" });

    const result = jobFinished("wh-zero");

    await expect(result).rejects.toThrow("refund amount not found");
    expect(mocks.exaSend).not.toHaveBeenCalled();
  });

  it("fails on non-transaction webhooks", async () => {
    webhooks.set("wh-dispute", {
      id: "wh-dispute",
      requestBody: { resource: "dispute", action: "created", body: { id: "dispute" }, id: "wh-dispute" },
      requestSentAt: "2026-01-01T00:00:00.000Z",
    });

    const result = jobFinished("wh-dispute");

    await expect(result).rejects.toThrow("unexpected resource");
    expect(mocks.exaSend).not.toHaveBeenCalled();
  });

  it("fails on non-refund actions", async () => {
    webhook("wh-created", { status: "pending" }, "created");

    const result = jobFinished("wh-created");

    await expect(result).rejects.toThrow("unexpected action");
    expect(mocks.exaSend).not.toHaveBeenCalled();
  });

  it("retries panda refund failures", async () => {
    webhook("wh-retry", { amount: 500, authorizedAmount: 1500, status: "pending" });
    vi.spyOn(segment, "track").mockReturnValue();
    mocks.exaSend.mockRejectedValueOnce(new Error("panda down")).mockResolvedValueOnce(null);

    await jobFinished("wh-retry", { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures terminal failures", async () => {
    webhook("wh-terminal", { amount: 500, authorizedAmount: 1500, status: "pending" });
    const error = new Error("refund failed");
    mocks.exaSend.mockRejectedValueOnce(error);

    const result = jobFinished("wh-terminal", { removeOnFail: false });

    await expect(result).rejects.toThrow("refund failed");
    await expect(queue.getFailedCount()).resolves.toBe(1);
    await expect(queue.getJobState("wh-terminal")).resolves.toBe("failed");
    const [job] = await queue.getFailed();
    if (!job) throw new Error("job not found");
    expect(job.id).toBe("wh-terminal");
    expect(job.failedReason).toBe("refund failed");
    expect(job.attemptsMade).toBe(1);
    expect(job.stacktrace).toHaveLength(1);
    expect(captureException).toHaveBeenCalledWith(error, {
      level: "fatal",
      fingerprint: ["{{ default }}", "refund.exhausted", "unknown"],
      tags: { queue: "refund", job: "refund", "panda.reason": "refund failed", "panda.reasonName": "Error" },
      extra: { attempts: 1, id: "wh-terminal", recipient: refunderAddress },
    });
    await job.remove();
  });

  it("captures panda webhook rejections", async () => {
    mocks.getWebhook.mockRejectedValueOnce(new ServiceError("Panda", 502, "panda error"));

    const result = jobFinished("wh-panda-down");

    await expect(result).rejects.toThrow("panda error");
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Panda502", message: "panda error", status: 502, cause: "panda error" }),
      {
        level: "fatal",
        fingerprint: ["{{ default }}", "refund.exhausted", "unknown"],
        tags: { queue: "refund", job: "refund", "panda.reason": "panda error", "panda.reasonName": "Panda502" },
        extra: { attempts: 1, id: "wh-panda-down", recipient: refunderAddress },
      },
    );
  });

  it("captures non-error failures", async () => {
    mocks.getWebhook.mockRejectedValueOnce("panda unavailable");

    const result = jobFinished("wh-non-error");

    await expect(result).rejects.toBeDefined();
    expect(mocks.exaSend).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(expect.anything(), {
      level: "fatal",
      fingerprint: ["{{ default }}", "refund.exhausted", "unknown"],
      tags: { queue: "refund", job: "refund", "panda.reason": "panda unavailable", "panda.reasonName": "Error" },
      extra: { attempts: 1, id: "wh-non-error", recipient: refunderAddress },
    });
  });

  it("continues sentry traces", async () => {
    webhook("wh-trace", { amount: 500, authorizedAmount: 1500, status: "pending" });
    vi.spyOn(segment, "track").mockReturnValue();

    await jobFinished("wh-trace", undefined, { sentryBaggage: "baggage", sentryTrace: "trace" });

    expect(continueTrace).toHaveBeenCalledWith({ sentryTrace: "trace", baggage: "baggage" }, expect.any(Function));
  });

  it("continues sentry traces with baggage only", async () => {
    webhook("wh-baggage", { amount: 500, authorizedAmount: 1500, status: "pending" });
    vi.spyOn(segment, "track").mockReturnValue();

    await jobFinished("wh-baggage", undefined, { sentryBaggage: "baggage" });

    expect(continueTrace).toHaveBeenCalledWith({ sentryTrace: undefined, baggage: "baggage" }, expect.any(Function));
  });

  it("captures worker errors", () => {
    const error = new Error("worker error");

    worker.queue.emit("error", error);

    expect(captureException).toHaveBeenCalledWith(error, { level: "error", tags: { queue: "refund" } });
  });

  it("captures failed events without a job", () => {
    const error = new Error("failed event error");

    worker.queue.emit("failed", undefined, error, "active");

    expect(captureException).toHaveBeenCalledWith(error, {
      level: "fatal",
      fingerprint: ["{{ default }}", "refund.exhausted", "unknown"],
      tags: { queue: "refund", job: undefined, "panda.reason": "failed event error", "panda.reasonName": "Error" },
      extra: { attempts: undefined, id: undefined, recipient: refunderAddress },
    });
  });

  it("captures only terminal failed events", async () => {
    webhook("wh-intermediate", { amount: 500, authorizedAmount: 1500, status: "pending" });
    const error = new Error("intermediate failure");
    mocks.exaSend.mockRejectedValue(error);

    const result = jobFinished("wh-intermediate", { attempts: 2, backoff: { type: "fixed", delay: 1 } });

    await expect(result).rejects.toThrow("intermediate failure");
    expect(mocks.exaSend).toHaveBeenCalledTimes(2);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "fatal",
      fingerprint: ["{{ default }}", "refund.exhausted", "unknown"],
      tags: { queue: "refund", job: "refund", "panda.reason": "intermediate failure", "panda.reasonName": "Error" },
      extra: { attempts: 2, id: "wh-intermediate", recipient: refunderAddress },
    });
  });
});

const withdrawAssetAbi = parseAbi([
  "function withdrawAsset(address collateralProxy, address asset, uint256 amount, address recipient, uint256 expiresAt, bytes32 salt, bytes signature)",
]);

const user = {
  id: "user",
  firstName: "First",
  lastName: "Last",
  email: "user@exa.test",
  isActive: true,
  phoneCountryCode: "54",
  phoneNumber: "1111111111",
  applicationStatus: "approved",
  applicationReason: "",
};

const mocks = vi.hoisted(() => ({
  exaSend: vi.fn<ReturnType<typeof W.extender>["exaSend"]>(),
  getUser: vi.fn<(id: string) => Promise<unknown>>(),
  getWebhook: vi.fn<(id: string) => Promise<unknown>>(),
  getWithdrawal: vi.fn<(amount: number, recipient: string, admin: string) => Promise<unknown>>(),
}));

vi.mock("../../utils/panda", async (importOriginal) => {
  const original = await importOriginal<typeof P>();
  return {
    ...original,
    default: ((options) => ({
      ...original.default(options),
      getUser: mocks.getUser,
      getWebhook: mocks.getWebhook,
      getWithdrawal: mocks.getWithdrawal,
    })) as typeof original.default,
  };
});

vi.mock("../../utils/wallet", async (importOriginal) => {
  const original = await importOriginal<typeof W>();
  const { foundry } = await import("viem/chains");
  return {
    ...original,
    default(signer: LocalAccount) {
      const wallet = original.default(signer, {
        ...foundry,
        rpcUrls: { ...foundry.rpcUrls, alchemy: foundry.rpcUrls.default },
      });
      const exaSend = wallet.exaSend;
      wallet.exaSend = async (...args) => {
        await mocks.exaSend(...args);
        return exaSend(...args);
      };
      return wallet;
    },
  };
});

vi.mock("@exactly/common/generated/chain", async (importOriginal) => {
  const original = await importOriginal<typeof C>();
  const { baseSepolia } = await import("viem/chains");
  return {
    ...original,
    default: Object.assign({ id: 0 }, baseSepolia, {
      rpcUrls: { ...baseSepolia.rpcUrls, alchemy: baseSepolia.rpcUrls.default },
    }),
    issuerCheckerAddress: inject("IssuerChecker"),
  };
});

function webhook(id: string, spend: Record<string, unknown>, action = "completed") {
  const requestBody = {
    id,
    resource: "transaction",
    action,
    body: {
      id,
      type: "spend",
      spend: {
        amount: 0,
        currency: "usd",
        cardId: "refund-card",
        cardType: "virtual",
        localAmount: 0,
        localCurrency: "usd",
        merchantCountry: "AR",
        merchantCategoryCode: "5411",
        merchantName: "merchant",
        userId: "user",
        authorizedAt: "2026-01-01T00:00:00.000Z",
        postedAt: "2026-01-01T00:00:01.000Z",
        ...spend,
      },
    },
  };
  webhooks.set(id, { id, requestBody, requestSentAt: "2026-01-01T00:00:00.000Z" });
  return requestBody;
}

async function jobFinished(id: string, options?: JobsOptions, data?: Partial<Refund>) {
  const job = await queue.add(
    "refund",
    { account, amount: 10_000_000, signature: "0x1234", timestamp: 1_700_000_000, ...data },
    { attempts: 1, jobId: id, removeOnComplete: true, removeOnFail: true, ...options },
  );
  await job.waitUntilFinished(events).catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
}
