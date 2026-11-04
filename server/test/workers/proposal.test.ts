import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/sentry";
import "../mocks/traceClient";
import { walletClient } from "../mocks/wallet";

import { captureException, startSpan, withScope } from "@sentry/node";
import { Queue, QueueEvents } from "bullmq";
import { env } from "node:process";
import * as v from "valibot";
import {
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeErrorResult,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  getContractError,
  http,
  maxUint256,
  nonceManager,
  padHex,
  parseEventLogs,
  RawContractError,
  zeroHash,
  type Address,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain, {
  auditorAbi,
  exaAccountFactoryAddress,
  exaPluginAbi,
  exaPreviewerAbi,
  exaPreviewerAddress,
  issuerCheckerAbi,
  marketAbi,
  marketUSDCAddress,
  marketWETHAddress,
  proposalManagerAbi,
  proposalManagerAddress,
  upgradeableModularAccountAbi,
  usdcAddress,
} from "@exactly/common/generated/chain";
import ProposalType, { decodeWithdraw } from "@exactly/common/ProposalType";
import shortenHex from "@exactly/common/shortenHex";
import deploy from "@exactly/plugin/deploy.json";

import t, { f } from "../../i18n";
import ensClient from "../../utils/ensClient";
import createOnesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import redis, { bullmq } from "../../utils/redis";
import wallet from "../../utils/wallet";
import { Proposal, Withdraw, type Job } from "../../workers/proposal/job";
import createProposal from "../../workers/proposal/queue";
import proposalWorker from "../../workers/proposal/worker";
import { connect } from "../../workers/worker";
import anvilClient from "../anvilClient";
import { finished, tip } from "../redis";

import type * as C from "@exactly/common/generated/chain";
import type * as sentry from "@sentry/node";
import type { InferOutput } from "valibot";

const bob = createWalletClient({
  chain,
  transport: http(),
  account: privateKeyToAccount(padHex("0xb0b"), { nonceManager }),
});
const bobAccount = deriveAddress(exaAccountFactoryAddress, { x: padHex(bob.account.address), y: zeroHash });
const stranger = getAddress(padHex("0xdead", { size: 20 }));
const receiver = getAddress(padHex("0xcafe", { size: 20 }));
const proposal = createProposal(redis);
const queue = new Queue<Job, void, "proposal">("proposal", { connection: bullmq });
const events = new QueueEvents("proposal", { connection: bullmq, lastEventId: await tip(bullmq, queue) });
const connection = connect(v.parse(v.pipe(v.string(), v.nonEmpty()), env.REDIS_URL));
const worker = proposalWorker({
  bullmq: connection,
  executor: walletClient.account,
  onesignal: createOnesignal("onesignal"),
});
const keeper = wallet(walletClient.account);
await worker.ready;

afterAll(async () => {
  await worker.close();
  await Promise.all([queue.close(), events.close(), proposal.close(), connection.quit()]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("proposal queue", () => {
  it("delays proposals until ten seconds after unlock", async () => {
    const unlock = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const message = v.parse(Proposal, {
      account: stranger,
      amount: 1n,
      data: "0x",
      market: marketUSDCAddress,
      nonce: 7n,
      proposalType: ProposalType.Swap,
      timestamp: 1,
      unlock,
    });

    await proposal.enqueue(message);

    const job = await queue.getJob(`${stranger}-7-0`);
    if (!job) throw new Error("job not found");
    expect(job.name).toBe("proposal");
    expect(job.data).toStrictEqual({
      account: stranger,
      amount: "1",
      data: "0x",
      market: marketUSDCAddress,
      nonce: "7",
      proposalType: ProposalType.Swap,
      retryCount: 0,
      timestamp: 1,
      unlock: String(unlock),
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(job.opts.delay).toBeGreaterThan(3_600_000);
    expect(job.opts.delay).toBeLessThanOrEqual(3_610_000);
    await expect(job.getState()).resolves.toBe("delayed");
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "schedule proposal", op: "queue.publish" }),
      expect.any(Function),
    );
    await job.remove();
  });

  it("delays legacy withdraws until ten seconds after unlock", async () => {
    const unlock = BigInt(Math.floor(Date.now() / 1000) + 3600);

    await proposal.enqueue(
      v.parse(Withdraw, { account: stranger, amount: 2n, market: marketUSDCAddress, receiver, unlock }),
    );

    const job = await queue.getJob(`${stranger}-${marketUSDCAddress}-${unlock}`);
    if (!job) throw new Error("job not found");
    expect(job.data).toStrictEqual({
      account: stranger,
      amount: "2",
      market: marketUSDCAddress,
      receiver,
      retryCount: 0,
      unlock: String(unlock),
      sentryBaggage: expect.any(String) as string,
      sentryTrace: expect.any(String) as string,
    });
    expect(job.opts.delay).toBeGreaterThan(3_600_000);
    await expect(job.getState()).resolves.toBe("delayed");
    expect(startSpan).toHaveBeenCalledWith(
      expect.objectContaining({ name: "schedule withdraw", op: "queue.publish" }),
      expect.any(Function),
    );
    await job.remove();
  });

  it("uses more attempts on mainnet", async () => {
    vi.resetModules();
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => {
      const original = await importOriginal<typeof C>();
      return { ...original, default: { ...original.default, testnet: false } };
    });

    try {
      const { attempts } = await import("../../workers/proposal/job");

      expect(attempts).toBe(20);
    } finally {
      vi.doUnmock("@exactly/common/generated/chain");
      vi.resetModules();
    }
  });
});

describe("proposal worker", () => {
  it("fails to start when the executor is not keeper", async () => {
    const outsiderConnection = connect(v.parse(v.pipe(v.string(), v.nonEmpty()), env.REDIS_URL));
    const outsider = proposalWorker({
      bullmq: outsiderConnection,
      executor: privateKeyToAccount(padHex("0xdead")),
      onesignal: createOnesignal("onesignal"),
    });

    try {
      await Promise.all([
        outsider.queue.waitUntilReady(),
        expect(outsider.ready).rejects.toThrow("executor is not keeper"),
      ]);
    } finally {
      await outsider.close();
      await outsiderConnection.quit();
    }
  });

  it("rejects invalid job data without retrying", async () => {
    const id = `${stranger}-invalid`;
    const result = finished(events, id);
    await queue.add("proposal", { account: stranger } as Job, {
      jobId: id,
      removeOnComplete: true,
      removeOnFail: true,
    });

    await expect(result).rejects.toThrow("invalid job data");
    await vi.waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "invalid job data" }), {
        level: "fatal",
        fingerprint: ["{{ default }}", "proposal.exhausted", "unknown"],
        tags: { queue: "proposal", job: "proposal" },
        extra: { account: stranger, attempts: 1, id },
      }),
    );
  });

  it("captures failed events without a job", () => {
    const error = new Error("failed event error");

    worker.queue.emit("failed", undefined, error, "active");

    expect(captureException).toHaveBeenCalledWith(error, {
      extra: { account: undefined, attempts: undefined, id: undefined },
      level: "fatal",
      fingerprint: ["{{ default }}", "proposal.exhausted", "unknown"],
      tags: { queue: "proposal", job: undefined },
    });
  });

  it("skips the nonce of none proposals", async () => {
    const exaSend = mockSend((call) => (call.functionName === "setProposalNonce" ? { status: "success" } : undefined));

    await run(proposed({ proposalType: ProposalType.None, nonce: 11n }));

    expect(exaSend.mock.calls.map(([, call]) => [call.functionName, call.args])).toStrictEqual([
      ["setProposalNonce", [12n]],
    ]);
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("completes executed proposals that are not withdraws", async () => {
    const setUser = await spyScopeSetUser();
    const exaSend = mockSend((call) => (call.functionName === "executeProposal" ? { status: "success" } : undefined));

    await run(proposed({ proposalType: ProposalType.Swap, nonce: 12n }));

    expect(exaSend.mock.calls.map(([, call]) => [call.functionName, call.args])).toStrictEqual([
      ["executeProposal", [12n]],
    ]);
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith({ id: stranger });
  });

  it.each([
    ["NonceTooLow", 13n],
    ["NoProposal", 113n],
  ] as const)("completes proposals that revert with %s", async (errorName, nonce) => {
    const abi = [{ type: "error", name: errorName, inputs: [] }] as const;
    const captures = vi.mocked(captureException).mock.calls.length;
    vi.spyOn(publicClient, "simulateContract").mockImplementation((params) => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data: encodeErrorResult({ abi, errorName }) }), {
        abi,
        address: stranger,
        functionName: params.functionName,
        args: [],
      });
    });

    await run(proposed({ nonce }));

    expect(vi.mocked(captureException).mock.calls.slice(captures)).toStrictEqual([]);
  });

  it("retries proposals whose nonce skip fails", async () => {
    const error = new Error("nonce failed");
    const captures = vi.mocked(captureException).mock.calls.length;
    vi.spyOn(publicClient, "simulateContract").mockImplementation((params) => {
      if (params.functionName === "setProposalNonce") throw error;
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data: "0x" }), {
        abi: [],
        address: stranger,
        functionName: params.functionName,
        args: [],
      });
    });

    await expect(run(proposed({ nonce: 14n }))).rejects.toThrow("nonce failed");

    const context = { proposal: { account: stranger, nonce: 14, proposalType: "Withdraw", retryCount: 0 } };
    expect(
      vi
        .mocked(captureException)
        .mock.calls.slice(captures)
        .filter(([captured, hint]) => captured === error && typeof hint === "object" && "contexts" in hint),
    ).toStrictEqual([
      [error, { level: "error", contexts: context, fingerprint: ["{{ default }}", "unknown"] }],
      [error, { level: "error", contexts: context, fingerprint: ["{{ default }}", "unknown"] }],
      [error, { level: "error", contexts: context, fingerprint: ["{{ default }}", "unknown"] }],
    ]);
    await vi.waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "nonce failed" }), {
        extra: { account: stranger, attempts: 3, id: `${stranger}-14-0` },
        level: "fatal",
        fingerprint: ["{{ default }}", "proposal.exhausted", "unknown"],
        tags: { queue: "proposal", job: "proposal" },
      }),
    );
  });

  it("retries proposals that fail without a contract revert", async () => {
    const error = new Error("rpc down");
    const captures = vi.mocked(captureException).mock.calls.length;
    const simulateContract = vi.spyOn(publicClient, "simulateContract").mockRejectedValue(error);

    await expect(run(proposed({ nonce: 15n }))).rejects.toThrow("rpc down");

    expect(simulateContract.mock.calls.map(([{ functionName }]) => functionName)).toStrictEqual([
      "executeProposal",
      "executeProposal",
      "executeProposal",
    ]);
    expect(vi.mocked(captureException).mock.calls.slice(captures)).toContainEqual([
      error,
      {
        level: "error",
        contexts: { proposal: { account: stranger, nonce: 15, proposalType: "Withdraw", retryCount: 0 } },
        fingerprint: ["{{ default }}", "unknown"],
      },
    ]);
  });

  it("reschedules timelocked proposals after the latest block when no longer pending", async () => {
    const abi = [{ type: "error", name: "Timelocked", inputs: [] }] as const;
    const { timestamp } = await publicClient.getBlock();
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date(Number(timestamp) * 1000));
    const add = vi.spyOn(Queue.prototype, "add");
    vi.spyOn(publicClient, "simulateContract").mockImplementation((params) => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data: encodeErrorResult({ abi, errorName: "Timelocked" }) }), {
        abi,
        address: stranger,
        functionName: params.functionName,
        args: [],
      });
    });

    await run(proposed({ nonce: 16n }));

    const retry = add.mock.calls.find((call) => call[2]?.jobId === `${stranger}-16-1`);
    if (!retry) throw new Error("missing rescheduled proposal");
    expect(BigInt((retry[1] as Job).unlock)).toBeGreaterThan(timestamp);
    expect((retry[1] as Job).retryCount).toBe(1);
    expect(retry[2]?.delay).toBeGreaterThan(10_000);
    await queue.remove(`${stranger}-16-1`);
  });

  it("delivers legacy withdraws and notifies the receiver", async () => {
    const setUser = await spyScopeSetUser();
    vi.spyOn(ensClient, "getEnsName").mockResolvedValue("alice.eth");
    mockSend((call) => (call.functionName === "withdraw" ? { status: "success" } : undefined));

    await run(withdraw(1_375_000n));

    expect(sendPushNotificationMock).toHaveBeenCalledExactlyOnceWith({
      userId: stranger,
      headings: t("Withdraw completed"),
      contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
        amount: f("1.375"),
        symbol: "USDC",
        recipient: "alice.eth",
      }),
    });
    expect(setUser).toHaveBeenCalledWith({ id: stranger });
  });

  it.each([
    ["missing", () => vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null)],
    ["failing", () => vi.spyOn(ensClient, "getEnsName").mockRejectedValue(new Error("ens failed"))],
  ])("notifies a shortened receiver when ens is %s", async (_, mockEns) => {
    mockEns();
    mockSend((call) => (call.functionName === "withdraw" ? { status: "success" } : undefined));

    await run(withdraw(1_376_000n));

    expect(sendPushNotificationMock).toHaveBeenCalledExactlyOnceWith({
      userId: stranger,
      headings: t("Withdraw completed"),
      contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
        amount: f("1.376"),
        symbol: "USDC",
        recipient: shortenHex(receiver),
      }),
    });
  });

  it("completes legacy withdraws despite a notification failure", async () => {
    const error = new Error("push failed");
    sendPushNotificationMock.mockRejectedValue(error);
    vi.spyOn(ensClient, "getEnsName").mockResolvedValue("alice.eth");
    mockSend((call) => (call.functionName === "withdraw" ? { status: "success" } : undefined));

    await run(withdraw(1_377_000n));

    expect(captureException).toHaveBeenCalledWith(error);
  });

  it("completes legacy withdraws with a reverted receipt without notifying", async () => {
    mockSend((call) => (call.functionName === "withdraw" ? { status: "reverted" } : undefined));

    await run(withdraw(1_385_000n));

    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it.each([
    ["InsufficientAccountLiquidity", encodeErrorResult({ abi: auditorAbi, errorName: "InsufficientAccountLiquidity" })],
    [
      "RuntimeValidationFunctionMissing",
      encodeErrorResult({
        abi: upgradeableModularAccountAbi,
        errorName: "RuntimeValidationFunctionMissing",
        args: ["0x3ccfd60b"],
      }),
    ],
    [
      "NoProposal",
      encodeErrorResult({
        abi: upgradeableModularAccountAbi,
        errorName: "PreExecHookReverted",
        args: [stranger, 0, encodeErrorResult({ abi: proposalManagerAbi, errorName: "NoProposal" })],
      }),
    ],
  ])("completes legacy withdraws on terminal %s", async (_, data) => {
    const captures = vi.mocked(captureException).mock.calls.length;
    mockSend((call) => {
      if (call.functionName !== "withdraw") return;
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data }), {
        abi: [...auditorAbi, ...upgradeableModularAccountAbi],
        address: stranger,
        functionName: "withdraw",
        args: [],
      });
    });

    await run(withdraw(1_400_000n));

    expect(vi.mocked(captureException).mock.calls.slice(captures)).toStrictEqual([]);
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it("retries legacy withdraws that fail with a non-terminal revert", async () => {
    const captures = vi.mocked(captureException).mock.calls.length;
    const error = getContractError(
      new RawContractError({
        data: encodeErrorResult({
          abi: upgradeableModularAccountAbi,
          errorName: "PreExecHookReverted",
          args: [stranger, 0, "0x1234"],
        }),
      }),
      { abi: upgradeableModularAccountAbi, address: stranger, functionName: "withdraw", args: [] },
    );
    mockSend((call) => {
      if (call.functionName === "withdraw") throw error as Error;
    });

    const failing = withdraw(1_955_000n);
    await expect(run(failing)).rejects.toThrow();
    await vi.waitFor(() => expect(vi.mocked(captureException).mock.calls.length - captures).toBe(4));

    const context = {
      withdraw: { account: stranger, market: marketUSDCAddress, receiver, amount: "1955000", retryCount: 0 },
    };
    expect(vi.mocked(captureException).mock.calls.slice(captures)).toStrictEqual([
      [error, { level: "error", contexts: context, fingerprint: ["{{ default }}", "PreExecHookReverted"] }],
      [error, { level: "error", contexts: context, fingerprint: ["{{ default }}", "PreExecHookReverted"] }],
      [error, { level: "error", contexts: context, fingerprint: ["{{ default }}", "PreExecHookReverted"] }],
      [
        expect.objectContaining({ name: "ContractFunctionExecutionError" }),
        {
          extra: { account: stranger, attempts: 3, id: `${stranger}-${marketUSDCAddress}-${failing.unlock}` },
          level: "fatal",
          fingerprint: ["{{ default }}", "proposal.exhausted", "PreExecHookReverted"],
          tags: { queue: "proposal", job: "proposal" },
        },
      ],
    ]);
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  describe("with bob's proposals", () => {
    it("executes withdraws in nonce order and notifies", async () => {
      const proposals = await propose([3_000_000n, 4_000_000n]);
      const receipts = executions(proposals.map(({ nonce }) => nonce));
      vi.spyOn(ensClient, "getEnsName").mockResolvedValueOnce("alice.eth").mockResolvedValueOnce(null);

      await run(...proposals);

      expect(
        hasExpectedTransfers(
          await receipts,
          proposals.map(({ amount, data }) => ({ receiver: getAddress(decodeWithdraw(data)), amount })),
        ),
      ).toBe(true);
      expect(sendPushNotificationMock).toHaveBeenCalledTimes(2);
      expect(sendPushNotificationMock).toHaveBeenCalledWith({
        userId: bobAccount,
        headings: t("Withdraw completed"),
        contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
          amount: f("3"),
          symbol: "USDC",
          recipient: "alice.eth",
        }),
      });
      expect(sendPushNotificationMock).toHaveBeenCalledWith({
        userId: bobAccount,
        headings: t("Withdraw completed"),
        contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
          amount: f("4"),
          symbol: "USDC",
          recipient: shortenHex(getAddress(decodeWithdraw(proposals[1]?.data ?? "0x"))),
        }),
      });
    });

    it("increments the nonce after a weth withdraw", async () => {
      const [withdrawal] = await propose([69n], marketWETHAddress);
      if (!withdrawal) throw new Error("missing proposal");

      await run(withdrawal);

      await expect(proposalNonce()).resolves.toBe(withdrawal.nonce + 1n);
    });

    it("captures a failed nonce increment after a weth withdraw", async () => {
      const [withdrawal] = await propose([70n], marketWETHAddress);
      if (!withdrawal) throw new Error("missing proposal");
      const error = new Error("nonce failed");
      mockSend((call) => {
        if (call.functionName === "setProposalNonce") throw error;
      });

      await run(withdrawal);

      expect(captureException).toHaveBeenCalledWith(error, {
        level: "error",
        contexts: {
          proposal: { account: bobAccount, nonce: Number(withdrawal.nonce), proposalType: "Withdraw", retryCount: 0 },
        },
        fingerprint: ["{{ default }}", "unknown"],
      });
      await anvilClient.waitForTransactionReceipt({
        hash: await bob.writeContract({
          address: bobAccount,
          functionName: "execute",
          args: [
            bobAccount,
            0n,
            encodeFunctionData({ abi: exaPluginAbi, functionName: "setProposalNonce", args: [withdrawal.nonce + 1n] }),
          ],
          abi: [...exaPluginAbi, ...upgradeableModularAccountAbi],
          gas: 6_666_666n,
        }),
      });
    });

    it("skips the nonce of reverting proposals", async () => {
      const [revert] = await propose([maxUint256]);
      if (!revert) throw new Error("missing proposal");
      const captures = vi.mocked(captureException).mock.calls.length;

      await run(revert);

      await expect(proposalNonce()).resolves.toBe(revert.nonce + 1n);
      expect(vi.mocked(captureException).mock.calls.slice(captures)).toContainEqual([
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "execution reverted"] }),
      ]);
    });

    it("reschedules timelocked proposals at their pending unlock", async () => {
      const [pending] = await propose([1_000_000n]);
      if (!pending) throw new Error("missing proposal");
      const abi = [{ type: "error", name: "Timelocked", inputs: [] }] as const;
      const { simulateContract } = publicClient;
      let injected = false;
      vi.spyOn(publicClient, "simulateContract").mockImplementation((params) => {
        if (injected || params.functionName !== "executeProposal") return simulateContract(params);
        injected = true;
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(new RawContractError({ data: encodeErrorResult({ abi, errorName: "Timelocked" }) }), {
          abi,
          address: stranger,
          functionName: params.functionName,
          args: [],
        });
      });
      const retried = finished(events, `${bobAccount}-${pending.nonce}-1`);
      const receipts = executions([pending.nonce]);

      await run(pending);
      await retried;

      expect(
        hasExpectedTransfers(await receipts, [
          { receiver: getAddress(decodeWithdraw(pending.data)), amount: pending.amount },
        ]),
      ).toBe(true);
    });

    it("executes idle proposals after NotNext", async () => {
      const proposals = await propose([4000n, 5000n, 6000n]);
      const [idle, skipped, next] = proposals;
      if (!idle || !skipped || !next) throw new Error("missing proposals");
      const abi = [{ type: "error", name: "NotNext", inputs: [] }] as const;
      const { simulateContract } = publicClient;
      let injected = false;
      vi.spyOn(publicClient, "simulateContract").mockImplementation((params) => {
        if (injected || params.functionName !== "executeProposal" || params.args?.[0] !== next.nonce) {
          return simulateContract(params);
        }
        injected = true;
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(new RawContractError({ data: encodeErrorResult({ abi, errorName: "NotNext" }) }), {
          abi,
          address: stranger,
          functionName: params.functionName,
          args: [],
        });
      });
      const retried = Promise.all(proposals.map((p) => finished(events, `${bobAccount}-${p.nonce}-1`)));
      const receipts = executions(proposals.map((p) => p.nonce));

      await run(next);
      const rescheduled = await Promise.all(proposals.map((p) => queue.getJob(`${bobAccount}-${p.nonce}-1`)));
      await retried;

      expect(rescheduled.map((job) => job?.opts.delay)).toStrictEqual([1000, 1000, 1000]);
      expect(
        hasExpectedTransfers(
          await receipts,
          proposals.map(({ amount, data }) => ({ receiver: getAddress(decodeWithdraw(data)), amount })),
        ),
      ).toBe(true);
      await expect(
        publicClient.readContract({
          address: exaPreviewerAddress,
          abi: exaPreviewerAbi,
          functionName: "pendingProposals",
          args: [bobAccount],
        }),
      ).resolves.toStrictEqual([]);
    });
  });
});

function proposed(overrides: Partial<InferOutput<typeof Proposal>> = {}) {
  return v.parse(Proposal, {
    account: stranger,
    amount: 1n,
    data: encodeAbiParameters([{ type: "address" }], [receiver]),
    market: marketUSDCAddress,
    nonce: 0n,
    proposalType: ProposalType.Withdraw,
    unlock: 1000n,
    ...overrides,
  });
}

let sequence = 1000n;
function withdraw(amount: bigint) {
  sequence += 1n;
  return v.parse(Withdraw, { account: stranger, amount, market: marketUSDCAddress, receiver, unlock: sequence });
}

async function run(...messages: (InferOutput<typeof Proposal> | InferOutput<typeof Withdraw>)[]) {
  const done = Promise.all(
    messages.map((m) =>
      finished(
        events,
        "nonce" in m ? [m.account, m.nonce, m.retryCount].join("-") : [m.account, m.market, m.unlock].join("-"),
      ),
    ),
  );
  done.catch(() => undefined);
  for (const m of messages) await proposal.enqueue(m);
  await done;
}

function mockSend(handle: (call: Parameters<typeof keeper.exaSend>[1]) => unknown) {
  if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
  const exaSend = keeper.exaSend.bind(keeper);
  return vi.spyOn(keeper, "exaSend").mockImplementation(async (span, call, options) => {
    if (call.address.toLowerCase() !== stranger.toLowerCase() && call.functionName !== "setProposalNonce") {
      return exaSend(span, call, options);
    }
    const receipt = handle(call) as Partial<TransactionReceipt> | undefined;
    if (receipt) return receipt as TransactionReceipt;
    return exaSend(span, call, options);
  });
}

async function propose(amounts: bigint[], market: Address = marketUSDCAddress) {
  const hash = await bob.writeContract({
    address: bobAccount,
    functionName: "executeBatch",
    args: [
      amounts.map((amount) => ({
        target: bobAccount,
        value: 0n,
        data: encodeFunctionData({
          abi: exaPluginAbi,
          functionName: "propose",
          args: [
            market,
            amount,
            ProposalType.Withdraw,
            encodeAbiParameters([{ type: "address" }], [padHex("0x69", { size: 20 })]),
          ],
        }),
      })),
    ],
    abi: [...upgradeableModularAccountAbi, ...exaPluginAbi, ...issuerCheckerAbi, ...auditorAbi, ...marketAbi],
    gas: 6_666_666n,
  });
  const receipt = await anvilClient.waitForTransactionReceipt({ hash });
  const proposals = parseEventLogs({
    logs: receipt.logs,
    abi: proposalManagerAbi,
    eventName: "Proposed",
    strict: true,
  }).map(({ args }) => v.parse(Proposal, args));
  await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
  const unlock = proposals.reduce((max, { unlock: current }) => (current > max ? current : max), 0n); // eslint-disable-line unicorn/prefer-math-min-max -- bigint
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
  return proposals;
}

function proposalNonce() {
  return publicClient.readContract({
    address: proposalManagerAddress,
    abi: proposalManagerAbi,
    functionName: "nonces",
    args: [bobAccount],
  });
}

function executions(nonces: bigint[]) {
  const pending = new Map(nonces.map((n) => [n, Promise.withResolvers<TransactionReceipt>()]));
  const exaSend = keeper.exaSend.bind(keeper);
  vi.spyOn(keeper, "exaSend").mockImplementation(async (span, call, options) => {
    const receipt = await exaSend(span, call, options);
    const target = call.functionName === "executeProposal" ? pending.get(call.args?.[0] as bigint) : undefined;
    if (receipt?.status === "success") target?.resolve(receipt);
    return receipt;
  });
  return Promise.all([...pending.values()].map(({ promise }) => promise));
}

function hasExpectedTransfers(
  receipts: readonly TransactionReceipt[],
  expected: { amount: bigint; receiver: Address }[],
) {
  const transferred = receipts
    .flatMap((receipt) =>
      receipt.logs
        .filter((l) => l.address.toLowerCase() === usdcAddress.toLowerCase())
        .map((l) => decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: l.topics, data: l.data }))
        .map((l) => ({ receiver: getAddress(l.args.to), amount: l.args.value })),
    )
    .filter(({ amount }) => amount > 0n);
  return expected.every(({ amount, receiver: to }) =>
    transferred.some((transfer) => transfer.amount === amount && transfer.receiver === to),
  );
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
