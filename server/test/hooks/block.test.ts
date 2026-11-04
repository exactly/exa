import { createWebhook, findWebhook, headerValidator } from "../mocks/alchemy";
import "../mocks/sentry";

import { captureException, startSpan } from "@sentry/node";
import { serialize } from "@wagmi/core";
import { Queue } from "bullmq";
import { testClient } from "hono/testing";
import { encodeAbiParameters, encodeEventTopics, getAddress, padHex, zeroAddress, type Hex } from "viem";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { marketUSDCAddress, proposalManagerAbi } from "@exactly/common/generated/chain";
import ProposalType from "@exactly/common/ProposalType";

import createBlockHook from "../../hooks/block";
import createAlchemy from "../../utils/alchemy";
import redis, { bullmq } from "../../utils/redis";
import createProposal from "../../workers/proposal/queue";

import type { Job } from "../../workers/proposal/job";

const proposal = createProposal(redis);
const queue = new Queue<Job, void, "proposal">("proposal", { connection: bullmq });
const defaults = { alchemy: createAlchemy("webhooks"), proposal, redis };
vi.mocked(findWebhook).mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- create path
const blockHook = createBlockHook(defaults);
const appClient = testClient(blockHook.app);
const account = getAddress(padHex("0xb10c", { size: 20 }));
const receiver = getAddress(padHex("0xcafe", { size: 20 }));
const unlock = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);

beforeAll(async () => {
  await blockHook.ready;
});

afterAll(async () => {
  await Promise.all([queue.close(), proposal.close()]);
});

afterEach(() => vi.restoreAllMocks());

describe("initialization", () => {
  it("starts with a discovered key when reconciliation fails", async () => {
    const existing: NonNullable<Awaited<ReturnType<typeof findWebhook>>> = {
      id: "existing",
      is_active: true,
      network: "ANVIL",
      signing_key: "existing-signing-key",
      webhook_type: "GRAPHQL",
      webhook_url: "http://localhost:8081/hooks/block",
    };
    vi.mocked(createWebhook).mockClear();
    vi.mocked(findWebhook).mockResolvedValueOnce(existing);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const currentHook = createBlockHook(defaults);

    await expect(currentHook.ready).resolves.toBeDefined();
    expect(createWebhook).not.toHaveBeenCalled();
    expect(headerValidator).toHaveBeenLastCalledWith(new Set([existing.signing_key]));
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "404 not found" }), {
      level: "warning",
    });
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
});

describe("proposal", () => {
  it("schedules proposals in nonce order", async () => {
    const add = vi.spyOn(Queue.prototype, "add");

    const response = await appClient.index.$post(
      payload(
        log(account, 2n, ProposalType.Swap, 20n, "0x"),
        log(account, 1n, ProposalType.Withdraw, 10n, encodeAbiParameters([{ type: "address" }], [receiver])),
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({});
    expect(add.mock.calls.map((call) => call[2]?.jobId)).toStrictEqual([`${account}-1-0`, `${account}-2-0`]);
    const job = await queue.getJob(`${account}-1-0`);
    if (!job) throw new Error("job not found");
    expect(job.data).toStrictEqual({
      account,
      amount: "10",
      data: encodeAbiParameters([{ type: "address" }], [receiver]),
      market: marketUSDCAddress,
      nonce: "1",
      proposalType: ProposalType.Withdraw,
      retryCount: 0,
      timestamp: 666,
      unlock: String(unlock),
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    await expect(job.getState()).resolves.toBe("delayed");
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "schedule proposal", op: "queue.publish" }),
      expect.any(Function),
    );
    await Promise.all([queue.remove(`${account}-1-0`), queue.remove(`${account}-2-0`)]);
  });

  it("captures invalid proposals without scheduling them", async () => {
    const add = vi.spyOn(Queue.prototype, "add");

    const response = await appClient.index.$post(payload(log(account, 3n, 99, 1n, "0x")));

    expect(response.status).toBe(200);
    expect(add).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ kind: "schema", type: "enum" })]),
      { level: "error" },
    );
  });

  it("schedules legacy withdraws", async () => {
    const response = await appClient.index.$post(
      payload({
        topics: [
          "0x0c652a21d96e4efed065c3ef5961e4be681be99b95dd55126669ae9be95767e0",
          encodeAbiParameters([{ type: "address" }], [account]),
          encodeAbiParameters([{ type: "address" }], [marketUSDCAddress]),
          encodeAbiParameters([{ type: "address" }], [receiver]),
        ],
        data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [30n, unlock]),
        account: { address: zeroAddress },
      }),
    );

    expect(response.status).toBe(200);
    const job = await queue.getJob(`${account}-${marketUSDCAddress}-${unlock}`);
    if (!job) throw new Error("job not found");
    expect(job.data).toStrictEqual({
      account,
      amount: "30",
      market: marketUSDCAddress,
      receiver,
      retryCount: 0,
      timestamp: 666,
      unlock: String(unlock),
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    await expect(job.getState()).resolves.toBe("delayed");
    await job.remove();
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
    const withdrawal = serialize({ account: stale, amount: 50n, market: marketUSDCAddress, receiver, unlock });
    const invalid = serialize({ account: stale, amount: 60n, market: marketUSDCAddress, unlock });
    await Promise.all([
      redis.zadd("proposals", Number(unlock), proposed),
      redis.zadd("withdraw", 1, invalid, Number(unlock), withdrawal),
    ]);

    await createBlockHook(defaults).ready;

    await expect(redis.zscore("proposals", proposed)).resolves.toBeNull();
    await expect(redis.zscore("withdraw", withdrawal)).resolves.toBeNull();
    await expect(redis.zscore("withdraw", invalid)).resolves.toBe("1");
    expect(captureException).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ kind: "schema", path: [expect.objectContaining({ key: "receiver" })] }),
      ]),
      { level: "error", contexts: { migrate: { key: "withdraw" } } },
    );
    const [scheduled, withdrawn] = await Promise.all([
      queue.getJob(`${stale}-4-2`),
      queue.getJob(`${stale}-${marketUSDCAddress}-${unlock}`),
    ]);
    expect(scheduled?.data).toStrictEqual({
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
    expect(withdrawn?.data).toStrictEqual({
      account: stale,
      amount: "50",
      market: marketUSDCAddress,
      receiver,
      retryCount: 0,
      unlock: String(unlock),
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    await Promise.all([scheduled?.remove(), withdrawn?.remove(), redis.zrem("withdraw", invalid)]);
  });
});

function log(owner: Hex, nonce: bigint, proposalType: number, amount: bigint, data: Hex) {
  return {
    topics: encodeEventTopics({
      abi: proposalManagerAbi,
      eventName: "Proposed",
      args: { account: owner, nonce, market: marketUSDCAddress },
    }) as [Hex, ...Hex[]],
    data: encodeAbiParameters(
      [{ type: "uint8" }, { type: "uint256" }, { type: "bytes" }, { type: "uint256" }],
      [proposalType, amount, data, unlock],
    ),
    account: { address: zeroAddress },
  };
}

function payload(...logs: { account: { address: Hex }; data: Hex; topics: [Hex, ...Hex[]] }[]) {
  return {
    header: {},
    json: { type: "GRAPHQL" as const, event: { data: { block: { number: 1, timestamp: 666, logs } } } },
  };
}

const blockPayload = {
  header: {},
  json: {
    type: "GRAPHQL" as const,
    event: { data: { block: { number: 666, timestamp: Math.floor(Date.now() / 1000), logs: [] } } },
  },
};

vi.mock("@sentry/node", { spy: true });
