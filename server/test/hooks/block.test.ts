import { createWebhook, findWebhook, headerValidator } from "../mocks/alchemy";
import "../mocks/deployments";
import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/sentry";
import "../mocks/wallet";

import { captureException, continueTrace, withScope } from "@sentry/node";
import { deserialize } from "@wagmi/core";
import { Queue, QueueEvents } from "bullmq";
import { testClient } from "hono/testing";
import { Redis } from "ioredis";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
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
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain, {
  auditorAbi,
  exaPluginAbi,
  issuerCheckerAbi,
  marketAbi,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import ProposalType, { decodeWithdraw } from "@exactly/common/ProposalType";
import shortenHex from "@exactly/common/shortenHex";
import deploy from "@exactly/plugin/deploy.json";

import blockHook from "../../hooks/block";
import t, { f } from "../../i18n";
import ensClient from "../../utils/ensClient";
import publicClient from "../../utils/publicClient";
import redis, { bullmq } from "../../utils/redis";
import revertFingerprint from "../../utils/revertFingerprint";
import wallet from "../../utils/wallet";
import executeWorker from "../../workers/execute/worker";
import anvilClient from "../anvilClient";

import type { Job as ExecuteJob } from "../../workers/execute/job";
import type * as sentry from "@sentry/node";
import type { Job as BullJob } from "bullmq";

type ProposalLog = Log<bigint, number, false, (typeof proposalManagerAbi)[29], true>;

let keeper: ReturnType<typeof wallet>;

const bob = createWalletClient({
  chain,
  transport: http(),
  account: privateKeyToAccount(padHex("0xb0b"), { nonceManager }),
});
const bobAccount = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob.account.address), y: zeroHash });
const defaults = {
  alchemyKey: "webhooks",
  executor: bob.account,
  onesignalKey: "onesignal",
  redisUrl: parse(pipe(string(), nonEmpty()), env.REDIS_URL),
};
vi.mocked(findWebhook).mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- create path
const hook = blockHook(defaults);
const appClient = testClient(hook.app);
const executeQueue = new Queue<ExecuteJob>("execute", { connection: bullmq });
const executeEvents = new QueueEvents("execute", { connection: bullmq });
let executeWorkerHandle: ReturnType<typeof executeWorker>;

beforeAll(async () => {
  await executeQueue.drain(true);
  executeWorkerHandle = executeWorker({
    executor: bob.account,
    onesignalKey: "onesignal",
    redisUrl: defaults.redisUrl,
  });
  await Promise.all([hook.ready, executeWorkerHandle.ready]);
  keeper = wallet(privateKeyToAccount(padHex("0x69")));
});

afterAll(() => Promise.all([executeEvents.close(), executeQueue.close(), executeWorkerHandle.close(), hook.close()]));

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
    const current = blockHook(defaults);

    try {
      await expect(current.ready).resolves.toBeDefined();
      expect(createWebhook).not.toHaveBeenCalled();
      expect(headerValidator).toHaveBeenLastCalledWith(new Set([existing.signing_key]));
      expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "404 not found" }), {
        level: "warning",
      });
    } finally {
      await current.close();
    }
  });

  it("fails without a signing key when initialization fails", async () => {
    const error = new Error("discovery failed");
    vi.mocked(findWebhook).mockRejectedValueOnce(error);
    const current = blockHook(defaults);

    try {
      await expect(current.ready).rejects.toBe(error);
    } finally {
      await current.close();
    }
  });
});

describe("validation", () => {
  it("accepts valid request", async () => {
    const response = await appClient.index.$post(blockPayload);

    expect(response.status).toBe(200);
  });
});

describe("proposal", () => {
  let proposals: ProposalLog[];

  describe("with valid proposals", () => {
    beforeEach(async () => {
      const hashes = await Promise.all(
        [3_000_000n, 4_000_000n].map((amount) =>
          execute(
            encodeFunctionData({
              abi: exaPluginAbi,
              functionName: "propose",
              args: [
                inject("MarketUSDC"),
                amount,
                ProposalType.Withdraw,
                encodeAbiParameters([{ type: "address" }], [padHex("0x69", { size: 20 })]),
              ],
            }),
          ),
        ),
      );
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      proposals = await getLogs(hashes);
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("execute withdraws", async () => {
      const setUser = await spyScopeSetUser();
      const withdraw = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const anotherWithdraw = proposals[1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
      const receiver = getAddress(decodeWithdraw(withdraw.args.data));
      vi.spyOn(ensClient, "getEnsName").mockResolvedValueOnce("alice.eth").mockResolvedValueOnce(null);

      const expected = [
        {
          receiver,
          amount: withdraw.args.amount,
        },
        {
          receiver: getAddress(decodeWithdraw(anotherWithdraw.args.data)),
          amount: anotherWithdraw.args.amount,
        },
      ];
      const proposalExecutions = waitForSuccessfulProposalExecutions([withdraw.args.nonce, anotherWithdraw.args.nonce]);
      const proposalRemovals = waitForProposalRemovals([
        { account: withdraw.args.account, nonce: withdraw.args.nonce },
        { account: anotherWithdraw.args.account, nonce: anotherWithdraw.args.nonce },
      ]);

      const [, receipts, removals] = await Promise.all([
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: [
                    { topics: withdraw.topics, data: withdraw.data, account: { address: withdraw.address } },
                    {
                      topics: anotherWithdraw.topics,
                      data: anotherWithdraw.data,
                      account: { address: anotherWithdraw.address },
                    },
                  ],
                },
              },
            },
          },
        }),
        proposalExecutions,
        proposalRemovals,
      ]);

      await vi.waitUntil(() => sendPushNotification.mock.calls.length === 2, 26_666);

      expect(sendPushNotification).toHaveBeenCalledWith({
        userId: bobAccount,
        headings: t("Withdraw completed"),
        contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
          amount: f("3"),
          symbol: "USDC",
          recipient: "alice.eth",
        }),
      });
      expect(sendPushNotification).toHaveBeenCalledWith({
        userId: bobAccount,
        headings: t("Withdraw completed"),
        contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
          amount: f("4"),
          symbol: "USDC",
          recipient: shortenHex(receiver),
        }),
      });
      expect(hasExpectedTransfers(receipts, expected)).toBe(true);
      expect(removals).toStrictEqual([1, 1]);
      expect(setUser).toHaveBeenCalledWith({ id: bobAccount });
    });
  });

  describe("with weth withdraw proposal", () => {
    beforeEach(async () => {
      const hash = await proposeWithdraw(69n, padHex("0x69", { size: 20 }), inject("MarketWETH"));
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      proposals = await getLogs([hash]);
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("increments nonce", async () => {
      const withdraw = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const nonceSkip = waitForProposalNonce(withdraw.args.account, withdraw.args.nonce);
      const proposalRemovals = waitForProposalRemovals([
        { account: withdraw.args.account, nonce: withdraw.args.nonce },
      ]);
      const [, removals] = await Promise.all([
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: [{ topics: withdraw.topics, data: withdraw.data, account: { address: withdraw.address } }],
                },
              },
            },
          },
        }),
        proposalRemovals,
        nonceSkip,
      ]);

      expect(removals).toStrictEqual([1]);
      await expect(
        publicClient.readContract({
          address: inject("ProposalManager"),
          abi: proposalManagerAbi,
          functionName: "nonces",
          args: [bobAccount],
        }),
      ).resolves.toBe(withdraw.args.nonce + 1n);
    });
  });

  describe("with reverting proposals", () => {
    beforeEach(async () => {
      const hash = await proposeWithdraw(maxUint256, padHex("0x69", { size: 20 }));
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      proposals = await getLogs([hash]);
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("increments nonce", async () => {
      const revert = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      const nonceSkip = waitForProposalNonce(revert.args.account, revert.args.nonce);
      const proposalRemovals = waitForProposalRemovals([{ account: revert.args.account, nonce: revert.args.nonce }]);

      const [removals] = await Promise.all([
        proposalRemovals,
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: [{ topics: revert.topics, data: revert.data, account: { address: revert.address } }],
                },
              },
            },
          },
        }),
        nonceSkip,
      ]);

      expect(removals).toStrictEqual([1]);
      await expect(
        publicClient.readContract({
          address: inject("ProposalManager"),
          abi: proposalManagerAbi,
          functionName: "nonces",
          args: [bobAccount],
        }),
      ).resolves.toBe(revert.args.nonce + 1n);
      const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
      expect(captureExceptionCalls).toEqual(
        expect.arrayContaining([
          [
            expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
            expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "execution reverted"] }),
          ],
        ]),
      );
    });

    it("handles NonceTooLow as success in outer catch", async () => {
      const setUser = await spyScopeSetUser();
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const errorAbi = [{ type: "error", name: "NonceTooLow", inputs: [] }] as const;
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      const removals = waitForRemovals([match]);
      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(
          new RawContractError({ data: encodeErrorResult({ abi: errorAbi, errorName: "NonceTooLow" }) }),
          { abi: errorAbi, address: bobAccount, functionName: "executeProposal", args: [proposal.args.nonce] },
        );
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      expect(await removals).toStrictEqual([1]);

      const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
      expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
      expect(setUser).toHaveBeenCalledWith({ id: bobAccount });
    });

    it("handles NoProposal as success in outer catch", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      const removals = waitForRemovals([match]);
      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(
          new RawContractError({ data: encodeErrorResult({ abi: proposalManagerAbi, errorName: "NoProposal" }) }),
          {
            abi: proposalManagerAbi,
            address: bobAccount,
            functionName: "executeProposal",
            args: [proposal.args.nonce],
          },
        );
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      expect(await removals).toStrictEqual([1]);

      const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
      expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
    });

    it("requeues Timelocked proposals without nonce skipping", async () => {
      const setUser = await spyScopeSetUser();
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const { simulateContract } = publicClient;
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      const add = vi.spyOn(Queue.prototype, "add");
      const removals = waitForRemovals([match]);
      if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
      const exaSend = keeper.exaSend.bind(keeper);
      const exaSendSpy = vi
        .spyOn(keeper, "exaSend")
        .mockImplementation((span, call, options) => exaSend(span, call, options));
      let timelocked = true;
      vi.spyOn(publicClient, "simulateContract").mockImplementation((params) => {
        if (params.functionName !== "executeProposal" || !timelocked) return simulateContract(params);
        timelocked = false;
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(
          new RawContractError({ data: encodeErrorResult({ abi: proposalManagerAbi, errorName: "Timelocked" }) }),
          { ...params, abi: proposalManagerAbi, args: [proposal.args.nonce] },
        );
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      expect(await removals).toStrictEqual([1]);
      const queued = add.mock.calls
        .map(([, data]) => data as unknown)
        .find((data): data is ExecuteJob => {
          if (typeof data !== "object" || data === null) return false;
          return (
            "account" in data &&
            data.account === proposal.args.account &&
            "nonce" in data &&
            data.nonce === String(proposal.args.nonce) &&
            "retryCount" in data &&
            data.retryCount === 1
          );
        });
      if (!queued) throw new Error("missing requeued proposal");
      expect(BigInt(queued.unlock)).toBeGreaterThanOrEqual(proposal.args.unlock);
      const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
      const proposalCaptureCalls = captureExceptionCalls.filter((call) => match.capture(call));
      expect(proposalCaptureCalls).toContainEqual([
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "Timelocked"] }),
      ]);
      expect(exaSendSpy.mock.calls.some(([, call]) => call.functionName === "setProposalNonce")).toBe(false);
      expect(setUser).toHaveBeenCalledWith({ id: bobAccount });
    });

    it.each([
      [
        "reason",
        () =>
          new ContractFunctionExecutionError(
            new ContractFunctionRevertedError({
              abi: [],
              functionName: "executeProposal",
              message: "execution reverted: proposal outer reason fallback",
            }),
            { abi: [], contractAddress: bobAccount, functionName: "executeProposal", args: [proposals[0]!.args.nonce] }, // eslint-disable-line @typescript-eslint/no-non-null-assertion
          ),
        "execution reverted: proposal outer reason fallback",
      ],
      [
        "signature",
        () =>
          getContractError(new RawContractError({ data: "0x12345678" }), {
            abi: [],
            address: bobAccount,
            functionName: "executeProposal",
            args: [proposals[0]!.args.nonce], // eslint-disable-line @typescript-eslint/no-non-null-assertion
          }),
        "0x12345678",
      ],
      [
        "unknown contract revert",
        () =>
          getContractError(new RawContractError({ data: "0x" }), {
            abi: [],
            address: bobAccount,
            functionName: "executeProposal",
            args: [proposals[0]!.args.nonce], // eslint-disable-line @typescript-eslint/no-non-null-assertion
          }),
        "unknown",
      ],
      ["unknown", () => new Error("nonce reset failed"), "unknown"],
    ] as const)("fingerprints worker failures by %s", async (_, createError, fingerprint) => {
      const setUser = await spyScopeSetUser();
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const error = createError();
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;

      failProposal(proposal, error);

      const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
      expect(
        captureExceptionCalls.filter((call) => matchProposal(proposal.args.account, proposal.args.nonce).capture(call)),
      ).toStrictEqual([
        [
          error,
          expect.objectContaining({
            level: "error",
            fingerprint: ["{{ default }}", fingerprint],
          }),
        ],
      ]);
      expect(setUser).toHaveBeenCalledWith({ id: bobAccount });
    });

    it("handles recovery NonceTooLow as success", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const errorAbi = [{ type: "error", name: "NonceTooLow", inputs: [] }] as const;
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      const removals = waitForRemovals([match]);
      vi.spyOn(publicClient, "simulateContract")
        .mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
          throw getContractError(new RawContractError({ data: "0x" }), {
            abi: [],
            address: bobAccount,
            functionName: "executeProposal",
            args: [proposal.args.nonce],
          });
        })
        .mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
          throw getContractError(
            new RawContractError({ data: encodeErrorResult({ abi: errorAbi, errorName: "NonceTooLow" }) }),
            {
              abi: errorAbi,
              address: bobAccount,
              functionName: "setProposalNonce",
              args: [proposal.args.nonce + 1n],
            },
          );
        });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      expect(await removals).toStrictEqual([1]);

      const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
      const recoveryCapture = captureExceptionCalls.find(
        ([error, hint]) =>
          match.capture([error, hint]) &&
          error instanceof Error &&
          "functionName" in error &&
          error.functionName === "setProposalNonce" &&
          typeof hint === "object" &&
          "contexts" in hint,
      );

      expect(recoveryCapture).toBeUndefined();
    });
  });

  describe("with wrapped error", () => {
    beforeEach(async () => {
      const hash = await proposeWithdraw(3_000_000n, padHex("0x69", { size: 20 }));
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      proposals = await getLogs([hash]);
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("fingerprints with inner selector", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(
          new RawContractError({
            data: encodeErrorResult({
              abi: wrappedErrorAbi,
              errorName: "WrappedError",
              args: [zeroAddress, "0x931997cf", "0x", "0x"],
            }),
          }),
          { abi: wrappedErrorAbi, address: bobAccount, functionName: "executeProposal", args: [proposal.args.nonce] },
        );
      });

      const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () => waitForTransactionReceipt.mock.settledResults.some(({ type }) => type !== "incomplete"),
        26_666,
      );

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "WrappedError", "0x931997cf"] }),
      );
    });

    it("fingerprints zero data errors", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(new RawContractError({ data: "0x" }), {
          abi: [],
          address: bobAccount,
          functionName: "executeProposal",
          args: [proposal.args.nonce],
        });
      });

      const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () => waitForTransactionReceipt.mock.settledResults.some(({ type }) => type !== "incomplete"),
        26_666,
      );

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "unknown"] }),
      );
    });

    it("fingerprints non-contract errors", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        throw new Error("test");
      });

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () =>
          vi
            .mocked(captureException)
            .mock.calls.some(
              ([error, context]) =>
                error instanceof Error &&
                error.message === "test" &&
                typeof context === "object" &&
                "fingerprint" in context,
            ),
        26_666,
      );

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "test" }),
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
      );
    });

    it("fingerprints unknown signatures", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

      vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(new RawContractError({ data: "0x12345678" }), {
          abi: [],
          address: bobAccount,
          functionName: "executeProposal",
          args: [proposal.args.nonce],
        });
      });

      const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");

      await appClient.index.$post({
        ...withdrawProposal,
        json: {
          ...withdrawProposal.json,
          event: {
            ...withdrawProposal.json.event,
            data: {
              ...withdrawProposal.json.event.data,
              block: {
                ...withdrawProposal.json.event.data.block,
                logs: [{ topics: proposal.topics, data: proposal.data, account: { address: proposal.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () => waitForTransactionReceipt.mock.settledResults.some(({ type }) => type !== "incomplete"),
        26_666,
      );

      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "0x12345678"] }),
      );
    });
  });

  describe.todo("with none proposal", () => {
    beforeEach(async () => {
      const hash = await execute(
        encodeFunctionData({
          abi: exaPluginAbi,
          functionName: "propose",
          args: [inject("MarketUSDC"), 1n, ProposalType.None, "0x"],
        }),
      );
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      proposals = await getLogs([hash]);
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock) * 1000));
    });

    it("increments nonce", async () => {
      const none = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");
      await Promise.all([
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: [{ topics: none.topics, data: none.data, account: { address: none.address } }],
                },
              },
            },
          },
        }),
        vi.waitUntil(
          () => waitForTransactionReceipt.mock.settledResults.some(({ type }) => type !== "incomplete"),
          6666,
        ),
      ]);

      await expect(
        publicClient.readContract({
          address: inject("ProposalManager"),
          abi: proposalManagerAbi,
          functionName: "nonces",
          args: [bobAccount],
        }),
      ).resolves.toBe(none.args.nonce + 1n);
    });
  });

  describe("with idle proposals", () => {
    beforeEach(async () => {
      const hash = await bob.writeContract({
        address: bobAccount,
        functionName: "executeBatch",
        args: [
          [4000n, 5000n, 6000n, 7000n, 8000n, 9000n].map((value) => ({
            target: bobAccount,
            value: 0n,
            data: encodeFunctionData({
              abi: exaPluginAbi,
              functionName: "propose",
              args: [
                inject("MarketUSDC"),
                value,
                ProposalType.Withdraw,
                encodeAbiParameters([{ type: "address" }], [padHex("0x69", { size: 20 })]),
              ],
            }),
          })),
        ],
        abi: upgradeableModularAccountAbi,
        gas: 6_666_666n,
      });
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      proposals = await getLogs([hash]);
      const maxUnlock = proposals.reduce((max, proposal) => {
        if (proposal.args.unlock > max) return proposal.args.unlock;
        return max;
      }, 0n);
      const block = await anvilClient.getBlock();
      if (block.timestamp <= maxUnlock) {
        await anvilClient.mine({ blocks: 1, interval: Number(maxUnlock - block.timestamp + 1n) });
      }
      vi.setSystemTime(new Date(Number(maxUnlock) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("executes proposal", async () => {
      const setUser = await spyScopeSetUser();
      const idle = proposals[1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const withdraw = proposals[3]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const another = proposals[4]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

      const expected = [
        {
          receiver: getAddress(decodeWithdraw(withdraw.args.data)),
          amount: withdraw.args.amount,
        },
        {
          receiver: getAddress(decodeWithdraw(idle.args.data)),
          amount: idle.args.amount,
        },
      ];
      const proposalExecutions = waitForSuccessfulProposalExecutions([withdraw.args.nonce, idle.args.nonce]);

      const [, receipts] = await Promise.all([
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: [
                    { topics: withdraw.topics, data: withdraw.data, account: { address: withdraw.address } },
                    { topics: another.topics, data: another.data, account: { address: another.address } },
                  ],
                },
              },
            },
          },
        }),
        proposalExecutions,
      ]);
      expect(hasExpectedTransfers(receipts, expected)).toBe(true);
      expect(setUser).toHaveBeenCalledWith({ id: bobAccount });
    });

    it("captures NotNext warning for out-of-order proposal execution", async () => {
      const idle = proposals[1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const withdraw = proposals[3]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const another = proposals[4]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(another.args.account, another.args.nonce);
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      const notNextAbi = [{ type: "error", name: "NotNext", inputs: [] }] as const;
      const { simulateContract } = publicClient;
      let injected = false;
      vi.spyOn(publicClient, "simulateContract").mockImplementation((params) => {
        if (
          !injected &&
          params.functionName === "executeProposal" &&
          params.args?.length === 1 &&
          params.args[0] === another.args.nonce
        ) {
          injected = true;
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
          throw getContractError(
            new RawContractError({ data: encodeErrorResult({ abi: notNextAbi, errorName: "NotNext" }) }),
            { abi: notNextAbi, address: bobAccount, functionName: "executeProposal", args: [another.args.nonce] },
          );
        }
        return simulateContract(params);
      });

      const proposalExecutions = waitForSuccessfulProposalExecutions([withdraw.args.nonce, idle.args.nonce]);
      const notNextCapture = vi.waitUntil(
        () =>
          vi
            .mocked(captureException)
            .mock.calls.slice(initialCaptureExceptionCalls)
            .filter((call) => match.capture(call))
            .some(
              ([, hint]) =>
                typeof hint === "object" &&
                "fingerprint" in hint &&
                Array.isArray(hint.fingerprint) &&
                hint.fingerprint[1] === "NotNext",
            ),
        26_666,
      );

      await Promise.all([
        appClient.index.$post({
          ...withdrawProposal,
          json: {
            ...withdrawProposal.json,
            event: {
              ...withdrawProposal.json.event,
              data: {
                ...withdrawProposal.json.event.data,
                block: {
                  ...withdrawProposal.json.event.data.block,
                  logs: [
                    { topics: withdraw.topics, data: withdraw.data, account: { address: withdraw.address } },
                    { topics: another.topics, data: another.data, account: { address: another.address } },
                  ],
                },
              },
            },
          },
        }),
        proposalExecutions,
        notNextCapture,
      ]);

      const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
      const proposalCaptureCalls = captureExceptionCalls.filter((call) => match.capture(call));
      expect(proposalCaptureCalls).toContainEqual([
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "NotNext"] }),
      ]);
    });
  });
});

describe("legacy withdraw", () => {
  const withdrawUnlock = 1000n;
  const withdrawAccount = getAddress(padHex("0xdead", { size: 20 }));
  const withdrawMarket = getAddress(padHex("0xbeef", { size: 20 }));
  const withdrawReceiver = getAddress(padHex("0xcafe", { size: 20 }));
  const { simulateContract } = publicClient;

  function legacyPayload(amount: bigint) {
    return {
      header: {},
      json: {
        type: "GRAPHQL" as const,
        event: {
          data: {
            block: {
              number: 1,
              timestamp: Number(withdrawUnlock),
              logs: [
                {
                  topics: [
                    "0x0c652a21d96e4efed065c3ef5961e4be681be99b95dd55126669ae9be95767e0",
                    encodeAbiParameters([{ type: "address" }], [withdrawAccount]),
                    encodeAbiParameters([{ type: "address" }], [withdrawMarket]),
                    encodeAbiParameters([{ type: "address" }], [withdrawReceiver]),
                  ] as [Hex, ...Hex[]],
                  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [amount, withdrawUnlock]),
                  account: { address: zeroAddress },
                },
              ],
            },
          },
        },
      },
    };
  }

  it("removes withdraw from queue on InsufficientAccountLiquidity", async () => {
    const setUser = await spyScopeSetUser();
    const amount = 1_000_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const removals = waitForRemovals([match]);
    const insufficientAccountLiquidityError = getContractError(
      new RawContractError({
        data: encodeErrorResult({ abi: auditorAbi, errorName: "InsufficientAccountLiquidity" }),
      }),
      { abi: auditorAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
    );
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw insufficientAccountLiquidityError;
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
    expect(revertFingerprint(insufficientAccountLiquidityError)).toEqual([
      "{{ default }}",
      "InsufficientAccountLiquidity",
    ]);
    expect(setUser).toHaveBeenCalledWith({ id: withdrawAccount });
  });

  it("removes withdraw from queue on NoProposal", async () => {
    const amount = 1_250_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const removals = waitForRemovals([match]);
    const noProposalError = getContractError(
      new RawContractError({
        data: encodeErrorResult({
          abi: upgradeableModularAccountAbi,
          errorName: "PreExecHookReverted",
          args: [withdrawAccount, 0, encodeErrorResult({ abi: proposalManagerAbi, errorName: "NoProposal" })],
        }),
      }),
      { abi: upgradeableModularAccountAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
    );
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw noProposalError;
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
    expect(revertFingerprint(noProposalError)).toEqual(["{{ default }}", "PreExecHookReverted"]);
    expect(
      noProposalError instanceof ContractFunctionExecutionError &&
        noProposalError.cause instanceof ContractFunctionRevertedError &&
        noProposalError.cause.data?.errorName === "PreExecHookReverted" &&
        noProposalError.cause.data.args?.[2] ===
          encodeErrorResult({ abi: proposalManagerAbi, errorName: "NoProposal" }),
    ).toBe(true);
  });

  it("removes withdraw from queue on RuntimeValidationFunctionMissing", async () => {
    const amount = 1_313_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const removals = waitForRemovals([match]);
    const runtimeValidationFunctionMissingError = getContractError(
      new RawContractError({
        data: encodeErrorResult({
          abi: upgradeableModularAccountAbi,
          errorName: "RuntimeValidationFunctionMissing",
          args: ["0x3ccfd60b"],
        }),
      }),
      { abi: upgradeableModularAccountAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
    );
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw runtimeValidationFunctionMissingError;
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
    expect(revertFingerprint(runtimeValidationFunctionMissingError)).toEqual([
      "{{ default }}",
      "RuntimeValidationFunctionMissing",
    ]);
  });

  it("sends withdraw notification when keeper returns receipt", async () => {
    const setUser = await spyScopeSetUser();
    const amount = 1_375_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const removals = waitForRemovals([match]);
    const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
    vi.spyOn(ensClient, "getEnsName").mockResolvedValue("alice.eth");
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw"
        ? Promise.resolve({ status: "success" } as TransactionReceipt)
        : exaSend(span, call, options),
    );
    vi.spyOn(publicClient, "readContract").mockImplementation(({ functionName }) => {
      if (functionName === "decimals") return Promise.resolve(6);
      if (functionName === "symbol") return Promise.resolve("exaUSDC");
      return Promise.reject(new Error("unexpected readContract call"));
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: withdrawAccount,
      headings: t("Withdraw completed"),
      contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
        amount: f("1.375"),
        symbol: "USDC",
        recipient: "alice.eth",
      }),
    });
    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
    expect(setUser).toHaveBeenCalledWith({ id: withdrawAccount });
  });

  it("sends withdraw notification with shortened receiver when ens is missing", async () => {
    const amount = 1_375_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const removals = waitForRemovals([match]);
    const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
    vi.spyOn(ensClient, "getEnsName").mockResolvedValue(null);
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw"
        ? Promise.resolve({ status: "success" } as TransactionReceipt)
        : exaSend(span, call, options),
    );
    vi.spyOn(publicClient, "readContract").mockImplementation(({ functionName }) => {
      if (functionName === "decimals") return Promise.resolve(6);
      if (functionName === "symbol") return Promise.resolve("exaUSDC");
      return Promise.reject(new Error("unexpected readContract call"));
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: withdrawAccount,
      headings: t("Withdraw completed"),
      contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
        amount: f("1.375"),
        symbol: "USDC",
        recipient: shortenHex(withdrawReceiver),
      }),
    });
    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("sends withdraw notification with shortened receiver when ens lookup fails", async () => {
    const amount = 1_375_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const removals = waitForRemovals([match]);
    const sendPushNotification = sendPushNotificationMock.mockResolvedValue({});
    vi.spyOn(ensClient, "getEnsName").mockRejectedValue(new Error("ens failed"));
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw"
        ? Promise.resolve({ status: "success" } as TransactionReceipt)
        : exaSend(span, call, options),
    );
    vi.spyOn(publicClient, "readContract").mockImplementation(({ functionName }) => {
      if (functionName === "decimals") return Promise.resolve(6);
      if (functionName === "symbol") return Promise.resolve("exaUSDC");
      return Promise.reject(new Error("unexpected readContract call"));
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: withdrawAccount,
      headings: t("Withdraw completed"),
      contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
        amount: f("1.375"),
        symbol: "USDC",
        recipient: shortenHex(withdrawReceiver),
      }),
    });
    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("captures withdraw notification errors", async () => {
    const error = new Error("push failed");
    const amount = 1_375_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const removals = waitForRemovals([match]);
    sendPushNotificationMock.mockRejectedValueOnce(error);
    vi.spyOn(ensClient, "getEnsName").mockResolvedValue("alice.eth");
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw"
        ? Promise.resolve({ status: "success" } as TransactionReceipt)
        : exaSend(span, call, options),
    );
    vi.spyOn(publicClient, "readContract").mockImplementation(({ functionName }) => {
      if (functionName === "decimals") return Promise.resolve(6);
      if (functionName === "symbol") return Promise.resolve("exaUSDC");
      return Promise.reject(new Error("unexpected readContract call"));
    });

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error), 26_666);

    expect(captureException).toHaveBeenCalledWith(error);
  });

  it("removes withdraw from queue when keeper returns reverted receipt", async () => {
    const amount = 1_385_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const removals = waitForRemovals([match]);
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw"
        ? Promise.resolve({ status: "reverted" } as TransactionReceipt)
        : exaSend(span, call, options),
    );

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("captures withdraw errors without contract revert details", async () => {
    const amount = 1_625_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const zrem = vi.spyOn(Redis.prototype, "zrem");
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      throw new Error("plain withdraw error");
    });

    await appClient.index.$post(legacyPayload(amount));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.slice(initialCaptureExceptionCalls)
          .some(
            ([error, hint]) =>
              error instanceof Error &&
              error.message === "plain withdraw error" &&
              typeof hint === "object" &&
              "contexts" in hint,
          ),
      26_666,
    );

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({ message: "plain withdraw error" }),
          expect.objectContaining({
            level: "error",
            contexts: {
              withdraw: {
                account: withdrawAccount,
                market: withdrawMarket,
                receiver: withdrawReceiver,
                amount: String(amount),
                retryCount: 0,
              },
            },
            fingerprint: ["{{ default }}", "unknown"],
          }),
        ],
      ]),
    );
    expect(zrem.mock.calls.some((call) => match.zrem(call))).toBe(false);
  });

  it("captures withdraw non-error throwables", async () => {
    const amount = 1_626_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const zrem = vi.spyOn(Redis.prototype, "zrem");
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) => {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- validates non-error throwables
      if (call.functionName === "withdraw") return Promise.reject("plain withdraw value");
      return exaSend(span, call, options);
    });

    await appClient.index.$post(legacyPayload(amount));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.slice(initialCaptureExceptionCalls)
          .some(([error, hint]) => error === "plain withdraw value" && typeof hint === "object" && "contexts" in hint),
      26_666,
    );

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls).toEqual(
      expect.arrayContaining([
        [
          "plain withdraw value",
          expect.objectContaining({
            level: "error",
            contexts: {
              withdraw: {
                account: withdrawAccount,
                market: withdrawMarket,
                receiver: withdrawReceiver,
                amount: String(amount),
                retryCount: 0,
              },
            },
            fingerprint: ["{{ default }}", "unknown"],
          }),
        ],
      ]),
    );
    expect(zrem.mock.calls.some((call) => match.zrem(call))).toBe(false);
  });

  it("captures keeper errors even when message matches terminal reason", async () => {
    const amount = 1_627_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const zrem = vi.spyOn(Redis.prototype, "zrem");
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    const withdrawSend: () => ReturnType<typeof keeper.exaSend> = () =>
      Promise.reject(new Error("InsufficientAccountLiquidity()"));
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw" ? withdrawSend() : exaSend(span, call, options),
    );

    await appClient.index.$post(legacyPayload(amount));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.slice(initialCaptureExceptionCalls)
          .some(
            ([error, hint]) =>
              error instanceof Error &&
              error.message === "InsufficientAccountLiquidity()" &&
              typeof hint === "object" &&
              "contexts" in hint,
          ),
      26_666,
    );

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({ message: "InsufficientAccountLiquidity()" }),
          expect.objectContaining({
            level: "error",
            contexts: {
              withdraw: {
                account: withdrawAccount,
                market: withdrawMarket,
                receiver: withdrawReceiver,
                amount: String(amount),
                retryCount: 0,
              },
            },
            fingerprint: ["{{ default }}", "unknown"],
          }),
        ],
      ]),
    );
    expect(zrem.mock.calls.some((call) => match.zrem(call))).toBe(false);
  });

  it("captures PreExecHookReverted without NoProposal as failed precondition", async () => {
    const amount = 1_955_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const zrem = vi.spyOn(Redis.prototype, "zrem");
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(
        new RawContractError({
          data: encodeErrorResult({
            abi: upgradeableModularAccountAbi,
            errorName: "PreExecHookReverted",
            args: [withdrawAccount, 0, "0x1234"],
          }),
        }),
        { abi: upgradeableModularAccountAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
      );
    });

    await appClient.index.$post(legacyPayload(amount));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.slice(initialCaptureExceptionCalls)
          .some(
            ([error, hint]) =>
              error instanceof Error &&
              "functionName" in error &&
              error.functionName === "withdraw" &&
              typeof hint === "object" &&
              "contexts" in hint &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("PreExecHookReverted"),
          ),
      26_666,
    );

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
          expect.objectContaining({
            level: "error",
            contexts: {
              withdraw: {
                account: withdrawAccount,
                market: withdrawMarket,
                receiver: withdrawReceiver,
                amount: String(amount),
                retryCount: 0,
              },
            },
            fingerprint: ["{{ default }}", "PreExecHookReverted"],
          }),
        ],
      ]),
    );
    expect(zrem.mock.calls.some((call) => match.zrem(call))).toBe(false);
  });

  it("removes withdraw from queue on terminal revert thrown by keeper", async () => {
    const amount = 1_965_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const removals = waitForRemovals([match]);
    const terminalError = getContractError(
      new RawContractError({
        data: encodeErrorResult({ abi: auditorAbi, errorName: "InsufficientAccountLiquidity" }),
      }),
      { abi: auditorAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
    );
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    const withdrawSend: () => ReturnType<typeof keeper.exaSend> = () => Promise.reject(terminalError as Error);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw" ? withdrawSend() : exaSend(span, call, options),
    );

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("removes withdraw from queue on NoProposal thrown by keeper", async () => {
    const amount = 1_975_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const removals = waitForRemovals([match]);
    const noProposalError = getContractError(
      new RawContractError({
        data: encodeErrorResult({
          abi: upgradeableModularAccountAbi,
          errorName: "PreExecHookReverted",
          args: [withdrawAccount, 0, encodeErrorResult({ abi: proposalManagerAbi, errorName: "NoProposal" })],
        }),
      }),
      { abi: upgradeableModularAccountAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
    );
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    const withdrawSend: () => ReturnType<typeof keeper.exaSend> = () => Promise.reject(noProposalError as Error);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw" ? withdrawSend() : exaSend(span, call, options),
    );

    await appClient.index.$post(legacyPayload(amount));

    expect(await removals).toStrictEqual([1]);

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("fingerprints withdraw wrapped errors with inner selector", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(
        new RawContractError({
          data: encodeErrorResult({
            abi: wrappedErrorAbi,
            errorName: "WrappedError",
            args: [zeroAddress, "0x931997cf", "0x", "0x"],
          }),
        }),
        { abi: wrappedErrorAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
      );
    });

    await appClient.index.$post(legacyPayload(1_500_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              "functionName" in error &&
              error.functionName === "withdraw" &&
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("WrappedError"),
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(1_500_000n),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "WrappedError", "0x931997cf"],
      }),
    );
  });

  it("fingerprints withdraw revert by reason", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      throw new ContractFunctionExecutionError(
        new ContractFunctionRevertedError({
          abi: [],
          functionName: "withdraw",
          message: "execution reverted: withdraw reason fallback",
        }),
        { abi: [], contractAddress: withdrawAccount, functionName: "withdraw" },
      );
    });

    await appClient.index.$post(legacyPayload(1_600_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              "functionName" in error &&
              error.functionName === "withdraw" &&
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("execution reverted: withdraw reason fallback"),
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(1_600_000n),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "execution reverted: withdraw reason fallback"],
      }),
    );
  });

  it("fingerprints withdraw revert by signature", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data: "0x12345678" }), {
        abi: [],
        address: withdrawAccount,
        functionName: "withdraw",
        args: [],
      });
    });

    await appClient.index.$post(legacyPayload(1_700_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              "functionName" in error &&
              error.functionName === "withdraw" &&
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("0x12345678"),
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(1_700_000n),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "0x12345678"],
      }),
    );
  });

  it("fingerprints withdraw revert by unknown contract data", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data: "0x" }), {
        abi: [],
        address: withdrawAccount,
        functionName: "withdraw",
        args: [],
      });
    });

    await appClient.index.$post(legacyPayload(1_750_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              "functionName" in error &&
              error.functionName === "withdraw" &&
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("unknown"),
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(1_750_000n),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "unknown"],
      }),
    );
  });

  it("fingerprints withdraw revert as unknown", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementation(async (params) => {
      if (params.functionName !== "withdraw") return simulateContract(params);
      throw new Error("withdraw failed");
    });

    await appClient.index.$post(legacyPayload(2_000_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              error.message === "withdraw failed" &&
              typeof hint === "object" &&
              "contexts" in hint,
          ),
      26_666,
    );

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "withdraw failed" }),
      expect.objectContaining({
        level: "error",
        contexts: {
          withdraw: {
            account: withdrawAccount,
            market: withdrawMarket,
            receiver: withdrawReceiver,
            amount: String(2_000_000n),
            retryCount: 0,
          },
        },
        fingerprint: ["{{ default }}", "unknown"],
      }),
    );
  });

  it("fingerprints withdraw outer catch with contract revert", async () => {
    const errorAbi = [{ type: "error", name: "Unauthorized", inputs: [] }] as const;
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    vi.mocked(continueTrace).mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(
        new RawContractError({
          data: encodeErrorResult({ abi: errorAbi, errorName: "Unauthorized" }),
        }),
        { abi: errorAbi, address: withdrawAccount, functionName: "withdraw", args: [] },
      );
    });

    await appClient.index.$post(legacyPayload(3_000_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([, hint]) =>
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("Unauthorized"),
          ),
      26_666,
    );

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    const captureExceptionFingerprints = captureExceptionCalls.flatMap(([, hint]) =>
      typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
    );

    expect(captureExceptionFingerprints).toEqual([["{{ default }}", "Unauthorized"]]);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "Unauthorized"] }),
    );
  });

  it("fingerprints withdraw outer catch by reason", async () => {
    const setUser = await spyScopeSetUser();
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    vi.mocked(continueTrace).mockImplementationOnce(() => {
      throw new ContractFunctionExecutionError(
        new ContractFunctionRevertedError({
          abi: [],
          functionName: "withdraw",
          message: "execution reverted: outer withdraw reason fallback",
        }),
        { abi: [], contractAddress: withdrawAccount, functionName: "withdraw" },
      );
    });

    await appClient.index.$post(legacyPayload(3_500_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.slice(initialCaptureExceptionCalls)
          .some(
            ([, hint]) =>
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("execution reverted: outer withdraw reason fallback"),
          ),
      26_666,
    );

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    const captureExceptionFingerprints = captureExceptionCalls.flatMap(([, hint]) =>
      typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
    );

    expect(captureExceptionFingerprints).toEqual([
      ["{{ default }}", "execution reverted: outer withdraw reason fallback"],
    ]);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({
        level: "error",
        fingerprint: ["{{ default }}", "execution reverted: outer withdraw reason fallback"],
      }),
    );
    expect(setUser).toHaveBeenCalledWith({ id: withdrawAccount });
  });

  it("fingerprints withdraw outer catch by signature", async () => {
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    vi.mocked(continueTrace).mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data: "0x12345678" }), {
        abi: [],
        address: withdrawAccount,
        functionName: "withdraw",
        args: [],
      });
    });

    await appClient.index.$post(legacyPayload(3_600_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.slice(initialCaptureExceptionCalls)
          .some(
            ([, hint]) =>
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("0x12345678"),
          ),
      26_666,
    );

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    const captureExceptionFingerprints = captureExceptionCalls.flatMap(([, hint]) =>
      typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
    );

    expect(captureExceptionFingerprints).toEqual([["{{ default }}", "0x12345678"]]);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "0x12345678"] }),
    );
  });

  it("fingerprints withdraw outer catch as unknown contract revert", async () => {
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    vi.mocked(continueTrace).mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(new RawContractError({ data: "0x" }), {
        abi: [],
        address: withdrawAccount,
        functionName: "withdraw",
        args: [],
      });
    });

    await appClient.index.$post(legacyPayload(3_700_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.slice(initialCaptureExceptionCalls)
          .some(
            ([, hint]) =>
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("unknown"),
          ),
      26_666,
    );

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    const captureExceptionFingerprints = captureExceptionCalls
      .filter(([error]) => error instanceof ContractFunctionExecutionError && error.functionName === "withdraw")
      .flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

    expect(captureExceptionFingerprints).toEqual([["{{ default }}", "unknown"]]);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "withdraw" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
  });

  it("fingerprints withdraw outer catch as unknown", async () => {
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    vi.mocked(continueTrace).mockImplementationOnce(() => {
      throw new Error("withdraw outer catch failed");
    });

    await appClient.index.$post(legacyPayload(4_000_000n));

    await vi.waitUntil(
      () =>
        vi
          .mocked(captureException)
          .mock.calls.some(
            ([error, hint]) =>
              error instanceof Error &&
              error.message === "withdraw outer catch failed" &&
              typeof hint === "object" &&
              "fingerprint" in hint &&
              Array.isArray(hint.fingerprint) &&
              hint.fingerprint.includes("unknown"),
          ),
      26_666,
    );

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    const captureExceptionFingerprints = captureExceptionCalls.flatMap(([, hint]) =>
      typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
    );

    expect(captureExceptionFingerprints).toEqual([["{{ default }}", "unknown"]]);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "withdraw outer catch failed" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
  });
});

const blockPayload = {
  header: {},
  json: {
    type: "GRAPHQL" as const,
    event: { data: { block: { number: 666, timestamp: Math.floor(Date.now() / 1000), logs: [] } } },
  },
};

const withdrawProposal = {
  header: {},
  json: {
    webhookId: "webhookId",
    id: "eventId",
    createdAt: "2025-02-28T20:04:49.443359731Z",
    type: "GRAPHQL" as const,
    event: {
      data: {
        block: {
          number: 24_484_514,
          timestamp: 1_740_771_568,
          logs: [{ topics: [], data: "0x", account: { address: zeroAddress } }],
        },
      },
      sequenceNumber: "10000000000578619000",
      network: "ANVIL",
    },
  },
};

function hasExpectedTransfers(
  receipts: readonly TransactionReceipt[],
  expected: { amount: bigint; receiver: Address }[],
) {
  const transferred = receipts
    .flatMap((receipt) =>
      receipt.logs
        .filter((l) => l.address.toLowerCase() === inject("USDC").toLowerCase())
        .map((l) => decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: l.topics, data: l.data }))
        .map((l) => ({ receiver: getAddress(l.args.to), amount: l.args.value })),
    )
    .filter(({ amount }) => amount > 0n);
  const transferCountByKey = new Map<string, number>();
  for (const transfer of transferred) {
    const key = `${transfer.receiver}:${transfer.amount}`;
    transferCountByKey.set(key, (transferCountByKey.get(key) ?? 0) + 1);
  }
  for (const transfer of expected) {
    const key = `${transfer.receiver}:${transfer.amount}`;
    const count = transferCountByKey.get(key) ?? 0;
    if (count === 0) return false;
    transferCountByKey.set(key, count - 1);
  }
  return true;
}

async function waitForSuccessfulProposalExecutions(expectedNonces: bigint[]) {
  if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
  const exaSend = keeper.exaSend.bind(keeper);
  const expected = new Set(expectedNonces);
  const successfulReceipts = new Map<bigint, TransactionReceipt>();
  vi.spyOn(keeper, "exaSend").mockImplementation(async (span, call, options) => {
    const receipt = await exaSend(span, call, options);
    if (
      call.functionName === "executeProposal" &&
      call.args?.length === 1 &&
      typeof call.args[0] === "bigint" &&
      expected.has(call.args[0]) &&
      receipt?.status === "success"
    )
      successfulReceipts.set(call.args[0], receipt);
    return receipt;
  });
  await vi.waitUntil(() => expectedNonces.every((nonce) => successfulReceipts.has(nonce)), 26_666);
  return expectedNonces.map((nonce) => {
    const receipt = successfulReceipts.get(nonce);
    if (!receipt) throw new Error(`missing successful receipt for nonce ${String(nonce)}`);
    return receipt;
  });
}

function waitForProposalNonce(account: Address, nonce: bigint) {
  const settled = Promise.withResolvers<boolean>();
  if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
  const exaSend = keeper.exaSend.bind(keeper);
  vi.spyOn(keeper, "exaSend").mockImplementation(async (span, call, options) => {
    const matched =
      call.functionName === "setProposalNonce" &&
      call.address.toLowerCase() === account.toLowerCase() &&
      call.args?.[0] === nonce + 1n;
    try {
      const receipt = await exaSend(span, call, options);
      if (matched) settled.resolve(true);
      return receipt;
    } catch (error) {
      if (matched) settled.reject(error);
      throw error;
    }
  });
  return settled.promise;
}

function waitForProposalRemovals(expected: { account: Address; nonce: bigint }[]) {
  return waitForRemovals(expected.map(({ account, nonce }) => matchProposal(account, nonce)));
}

function waitForRemovals(matches: { jobId?(id: string): boolean; zrem?(args: unknown[]): boolean }[]) {
  const remove = redis.zrem.bind(redis);
  const removals = matches.map((match) => ({
    ...Promise.withResolvers<number>(),
    match,
  }));
  for (const removal of removals) {
    if (!removal.match.jobId) continue;
    const complete = ({ jobId }: { jobId: string }) => {
      if (removal.match.jobId?.(jobId)) {
        executeEvents.off("completed", complete);
        executeEvents.off("failed", failed);
        removal.resolve(1);
      }
    };
    const failed = ({ failedReason, jobId }: { failedReason: string; jobId: string }) => {
      if (removal.match.jobId?.(jobId)) {
        executeEvents.off("completed", complete);
        executeEvents.off("failed", failed);
        removal.reject(new Error(failedReason));
      }
    };
    executeEvents.on("completed", complete);
    executeEvents.on("failed", failed);
  }
  vi.spyOn(Redis.prototype, "zrem").mockImplementation(async (...args) => {
    const removal = removals.find(({ match }) => match.zrem?.(args));
    try {
      const count = await remove(...args);
      removal?.resolve(count);
      return count;
    } catch (error) {
      removal?.reject(error);
      throw error;
    }
  });
  return Promise.all(removals.map(({ promise }) => promise));
}

function execute(calldata: Hex) {
  return bob.writeContract({
    address: bobAccount,
    functionName: "execute",
    args: [bobAccount, 0n, calldata],
    abi: [...exaPluginAbi, ...issuerCheckerAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi],
    gas: 6_666_666n,
  });
}

function proposeWithdraw(amount: bigint, receiver: Address, market = inject("MarketUSDC")) {
  return execute(
    encodeFunctionData({
      abi: exaPluginAbi,
      functionName: "propose",
      args: [market, amount, ProposalType.Withdraw, encodeAbiParameters([{ type: "address" }], [receiver])],
    }),
  );
}

async function getLogs(hashes: Hex[]) {
  const receipts = await Promise.all(hashes.map((hash) => anvilClient.waitForTransactionReceipt({ hash })));
  return parseEventLogs<typeof proposalManagerAbi, true, "Proposed">({
    logs: receipts.flatMap((r) => r.logs),
    abi: proposalManagerAbi,
    eventName: "Proposed",
    strict: true,
  });
}

afterEach(() => vi.restoreAllMocks());

vi.mock("@sentry/node", { spy: true });

const wrappedErrorAbi = [
  {
    type: "error",
    name: "WrappedError",
    inputs: [
      { name: "target", type: "address" },
      { name: "selector", type: "bytes4" },
      { name: "reason", type: "bytes" },
      { name: "details", type: "bytes" },
    ],
  },
] as const;

function matchProposal(account: Address, nonce: bigint) {
  return {
    capture([error, hint]: unknown[]) {
      if (typeof hint === "object" && hint !== null && "contexts" in hint) {
        const contexts = (hint as { contexts?: unknown }).contexts;
        if (typeof contexts === "object" && contexts !== null && "proposal" in contexts) {
          const proposal = (contexts as { proposal?: unknown }).proposal;
          return (
            typeof proposal === "object" &&
            proposal !== null &&
            "account" in proposal &&
            proposal.account === account &&
            "nonce" in proposal &&
            proposal.nonce === Number(nonce)
          );
        }
      }
      return (
        typeof error === "object" &&
        error !== null &&
        "functionName" in error &&
        error.functionName === "executeProposal" &&
        "contractAddress" in error &&
        (error.contractAddress as string).toLowerCase() === account.toLowerCase() &&
        "args" in error &&
        Array.isArray(error.args) &&
        error.args[0] === nonce
      );
    },
    jobId(id: string) {
      return id.startsWith(`${account}-${String(nonce)}-`);
    },
  };
}

function failProposal(proposal: ProposalLog, error: Error) {
  const { account, amount, data, market, nonce, proposalType, unlock } = proposal.args;
  executeWorkerHandle.queue.emit(
    "failed",
    {
      attemptsMade: 1,
      data: {
        account,
        amount: String(amount),
        data,
        market,
        nonce: String(nonce),
        proposalType,
        retryCount: 0,
        unlock: String(unlock),
      },
      id: `${account}-${String(nonce)}-0`,
      name: "execute",
      opts: { attempts: 1 },
    } as BullJob<ExecuteJob>,
    error,
    "active",
  );
}

function matchWithdraw(amount: bigint, account: Address, market: Address, receiver: Address) {
  return {
    capture([, hint]: unknown[]) {
      if (typeof hint !== "object" || hint === null || !("contexts" in hint)) return false;
      const contexts = (hint as { contexts?: unknown }).contexts;
      if (typeof contexts !== "object" || contexts === null || !("withdraw" in contexts)) return false;
      const withdraw = (contexts as { withdraw?: unknown }).withdraw;
      return (
        typeof withdraw === "object" &&
        withdraw !== null &&
        "account" in withdraw &&
        withdraw.account === account &&
        "market" in withdraw &&
        withdraw.market === market &&
        "receiver" in withdraw &&
        withdraw.receiver === receiver &&
        "amount" in withdraw &&
        withdraw.amount === String(amount)
      );
    },
    zrem([key, message]: unknown[]) {
      if (key !== "withdraw" || typeof message !== "string") return false;
      const payload = deserialize(message);
      if (typeof payload !== "object" || payload === null) return false;
      return (
        "account" in payload &&
        payload.account === account &&
        "market" in payload &&
        payload.market === market &&
        "receiver" in payload &&
        payload.receiver === receiver &&
        "amount" in payload &&
        payload.amount === amount
      );
    },
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
