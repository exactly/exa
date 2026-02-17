import "../mocks/alchemy";
import "../mocks/deployments";
import "../mocks/onesignal";
import "../mocks/redis";
import "../mocks/sentry";

import { captureException, continueTrace } from "@sentry/node";
import { deserialize } from "@wagmi/core";
import { testClient } from "hono/testing";
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
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";

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
import deploy from "@exactly/plugin/deploy.json";

import app from "../../hooks/block";
import ensClient from "../../utils/ensClient";
import keeper from "../../utils/keeper";
import * as onesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import redis from "../../utils/redis";
import revertFingerprint from "../../utils/revertFingerprint";
import anvilClient from "../anvilClient";

const bob = createWalletClient({
  chain,
  transport: http(),
  account: privateKeyToAccount(padHex("0xb0b"), { nonceManager }),
});
const bobAccount = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob.account.address), y: zeroHash });
const appClient = testClient(app);

describe("validation", () => {
  it("accepts valid request", async () => {
    const response = await appClient.index.$post(blockPayload);

    expect(response.status).toBe(200);
  });
});

describe("proposal", () => {
  let proposals: Log<bigint, number, false, (typeof proposalManagerAbi)[29], true>[];

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
      vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("execute withdraws", async () => {
      const withdraw = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const anotherWithdraw = proposals[1]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion

      const expected = [
        {
          receiver: getAddress(decodeWithdraw(withdraw.args.data)),
          amount: withdraw.args.amount,
        },
        {
          receiver: getAddress(decodeWithdraw(anotherWithdraw.args.data)),
          amount: anotherWithdraw.args.amount,
        },
      ];
      const proposalExecutions = waitForSuccessfulProposalExecutions([withdraw.args.nonce, anotherWithdraw.args.nonce]);

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
      ]);
      expect(hasExpectedTransfers(receipts, expected)).toBe(true);
    });
  });

  describe("with weth withdraw proposal", () => {
    beforeEach(async () => {
      const hash = await proposeWithdraw(69n, padHex("0x69", { size: 20 }), inject("MarketWETH"));
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      proposals = await getLogs([hash]);
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("increments nonce", async () => {
      const withdraw = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
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
                  logs: [{ topics: withdraw.topics, data: withdraw.data, account: { address: withdraw.address } }],
                },
              },
            },
          },
        }),
        vi.waitUntil(
          () => waitForTransactionReceipt.mock.settledResults.some(({ type }) => type !== "incomplete"),
          26_666,
        ),
      ]);

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
      vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("increments nonce", async () => {
      const revert = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;

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
                logs: [{ topics: revert.topics, data: revert.data, account: { address: revert.address } }],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        async () =>
          (await publicClient.readContract({
            address: inject("ProposalManager"),
            abi: proposalManagerAbi,
            functionName: "nonces",
            args: [bobAccount],
          })) ===
          revert.args.nonce + 1n,
        26_666,
      );

      const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
      expect(captureExceptionCalls).toEqual(
        expect.arrayContaining([
          [
            expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
            expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "execution reverted"] }),
          ],
        ]),
      );
    });

    it("handles NonceTooLow as success in outer catch", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const errorAbi = [{ type: "error", name: "NonceTooLow", inputs: [] }] as const;
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      const zrem = vi.spyOn(redis, "zrem");
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

      await vi.waitUntil(() => zrem.mock.calls.some((call) => match.zrem(call)), 26_666);

      const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
      expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
    });

    it("handles NoProposal as success in outer catch", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      const zrem = vi.spyOn(redis, "zrem");
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

      await vi.waitUntil(() => zrem.mock.calls.some((call) => match.zrem(call)), 26_666);

      const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
      expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
    });

    it("fingerprints outer catch by reason", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const simulateContract = vi.spyOn(publicClient, "simulateContract");
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      vi.mocked(continueTrace).mockImplementationOnce(() => {
        throw new ContractFunctionExecutionError(
          new ContractFunctionRevertedError({
            abi: [],
            functionName: "executeProposal",
            message: "execution reverted: proposal outer reason fallback",
          }),
          { abi: [], contractAddress: bobAccount, functionName: "executeProposal" },
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
                hint.fingerprint.includes("execution reverted: proposal outer reason fallback"),
            ),
        26_666,
      );

      const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
      const captureExceptionFingerprints = captureExceptionCalls.flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

      expect(simulateContract).not.toHaveBeenCalled();
      expect(captureExceptionFingerprints).toEqual([
        ["{{ default }}", "execution reverted: proposal outer reason fallback"],
      ]);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({
          level: "error",
          fingerprint: ["{{ default }}", "execution reverted: proposal outer reason fallback"],
        }),
      );
    });

    it("fingerprints outer catch by signature", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const simulateContract = vi.spyOn(publicClient, "simulateContract");
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      vi.mocked(continueTrace).mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(new RawContractError({ data: "0x12345678" }), {
          abi: [],
          address: bobAccount,
          functionName: "executeProposal",
          args: [proposal.args.nonce],
        });
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

      expect(simulateContract).not.toHaveBeenCalled();
      expect(captureExceptionFingerprints).toEqual([["{{ default }}", "0x12345678"]]);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "0x12345678"] }),
      );
    });

    it("fingerprints outer catch as unknown contract revert", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const simulateContract = vi.spyOn(publicClient, "simulateContract");
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      vi.mocked(continueTrace).mockImplementationOnce(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
        throw getContractError(new RawContractError({ data: "0x" }), {
          abi: [],
          address: bobAccount,
          functionName: "executeProposal",
          args: [proposal.args.nonce],
        });
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
      const captureExceptionFingerprints = captureExceptionCalls.flatMap(([, hint]) =>
        typeof hint === "object" && "fingerprint" in hint && Array.isArray(hint.fingerprint) ? [hint.fingerprint] : [],
      );

      expect(simulateContract).not.toHaveBeenCalled();
      expect(captureExceptionFingerprints).toEqual([["{{ default }}", "unknown"]]);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
      );
    });

    it("fingerprints outer catch as unknown", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const simulateContract = vi.spyOn(publicClient, "simulateContract");
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      vi.mocked(continueTrace).mockImplementationOnce(() => {
        throw new Error("nonce reset failed");
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
              ([error, hint]) =>
                error instanceof Error &&
                error.message === "nonce reset failed" &&
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

      expect(simulateContract).not.toHaveBeenCalled();
      expect(captureExceptionFingerprints).toEqual([["{{ default }}", "unknown"]]);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "nonce reset failed" }),
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
      );
    });

    it("handles recovery NonceTooLow as success", async () => {
      const proposal = proposals[0]!; // eslint-disable-line @typescript-eslint/no-non-null-assertion
      const match = matchProposal(proposal.args.account, proposal.args.nonce);
      const errorAbi = [{ type: "error", name: "NonceTooLow", inputs: [] }] as const;
      const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
      const zrem = vi.spyOn(redis, "zrem");
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

      await vi.waitUntil(() => zrem.mock.calls.some((call) => match.zrem(call)), 26_666);

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
      vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
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
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "WrappedError", "0x931997cf"] }),
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
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
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
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "0x12345678"] }),
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
      vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
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
      const hashes = await Promise.all(
        [4000n, 5000n, 6000n, 7000n, 8000n, 9000n].map((v) => proposeWithdraw(v, padHex("0x69", { size: 20 }))),
      );
      await anvilClient.mine({ blocks: 1, interval: deploy.proposalManager.delay[anvil.id] });
      proposals = await getLogs(hashes);
      const unlock = proposals[0]?.args.unlock ?? 0n;
      vi.setSystemTime(new Date(Number(unlock + 10n) * 1000));
    });

    afterEach(() => vi.useRealTimers());

    it("executes proposal", async () => {
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
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "NotNext"] }),
      );
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
    const amount = 1_000_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const zrem = vi.spyOn(redis, "zrem");
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

    await vi.waitUntil(() => zrem.mock.calls.some((call) => match.zrem(call)), 26_666);

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
    expect(revertFingerprint(insufficientAccountLiquidityError)).toEqual([
      "{{ default }}",
      "InsufficientAccountLiquidity",
    ]);
  });

  it("removes withdraw from queue on NoProposal", async () => {
    const amount = 1_250_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const zrem = vi.spyOn(redis, "zrem");
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

    await vi.waitUntil(() => zrem.mock.calls.some((call) => match.zrem(call)), 26_666);

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
    const zrem = vi.spyOn(redis, "zrem");
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

    await vi.waitUntil(() => zrem.mock.calls.some((call) => match.zrem(call)), 26_666);

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
    expect(revertFingerprint(runtimeValidationFunctionMissingError)).toEqual([
      "{{ default }}",
      "RuntimeValidationFunctionMissing",
    ]);
  });

  it("sends withdraw notification when keeper returns receipt", async () => {
    const amount = 1_375_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const zrem = vi.spyOn(redis, "zrem");
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification").mockResolvedValue({});
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

    await vi.waitUntil(() => zrem.mock.calls.some((call) => match.zrem(call)), 26_666);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: withdrawAccount,
      headings: { en: "Withdraw completed" },
      contents: { en: "1.375 USDC sent to alice.eth" },
    });
    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("removes withdraw from queue when keeper returns reverted receipt", async () => {
    const amount = 1_385_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const zrem = vi.spyOn(redis, "zrem");
    if (vi.isMockFunction(keeper.exaSend)) throw new Error("unexpected keeper exaSend mock");
    const exaSend = keeper.exaSend.bind(keeper);
    vi.spyOn(keeper, "exaSend").mockImplementation((span, call, options) =>
      call.functionName === "withdraw"
        ? Promise.resolve({ status: "reverted" } as TransactionReceipt)
        : exaSend(span, call, options),
    );

    await appClient.index.$post(legacyPayload(amount));

    await vi.waitUntil(() => zrem.mock.calls.some((call) => match.zrem(call)), 26_666);

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("captures withdraw errors without contract revert details", async () => {
    const amount = 1_625_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const zrem = vi.spyOn(redis, "zrem");
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
    const zrem = vi.spyOn(redis, "zrem");
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
    const zrem = vi.spyOn(redis, "zrem");
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
    const zrem = vi.spyOn(redis, "zrem");
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
    const zrem = vi.spyOn(redis, "zrem");
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

    await vi.waitUntil(() => zrem.mock.calls.some((call) => match.zrem(call)), 26_666);

    const captureExceptionCalls = vi.mocked(captureException).mock.calls.slice(initialCaptureExceptionCalls);
    expect(captureExceptionCalls.filter((call) => match.capture(call))).toEqual([]);
  });

  it("removes withdraw from queue on NoProposal thrown by keeper", async () => {
    const amount = 1_975_000n;
    const match = matchWithdraw(amount, withdrawAccount, withdrawMarket, withdrawReceiver);
    const initialCaptureExceptionCalls = vi.mocked(captureException).mock.calls.length;
    const zrem = vi.spyOn(redis, "zrem");
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

    await vi.waitUntil(() => zrem.mock.calls.some((call) => match.zrem(call)), 26_666);

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
    const captureExceptionFingerprints = captureExceptionCalls.flatMap(([, hint]) =>
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

function waitForSuccessfulProposalExecutions(expectedNonces: bigint[]) {
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
  return vi
    .waitUntil(() => expectedNonces.every((nonce) => successfulReceipts.has(nonce)), 26_666)
    .then(() =>
      expectedNonces.map((nonce) => {
        const receipt = successfulReceipts.get(nonce);
        if (!receipt) throw new Error(`missing successful receipt for nonce ${String(nonce)}`);
        return receipt;
      }),
    );
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
  const receipts = await Promise.all(hashes.map((hash) => anvilClient.getTransactionReceipt({ hash })));
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
    capture([, hint]: unknown[]) {
      if (typeof hint !== "object" || hint === null || !("contexts" in hint)) return false;
      const contexts = (hint as { contexts?: unknown }).contexts;
      if (typeof contexts !== "object" || contexts === null || !("proposal" in contexts)) return false;
      const proposal = (contexts as { proposal?: unknown }).proposal;
      return (
        typeof proposal === "object" &&
        proposal !== null &&
        "account" in proposal &&
        proposal.account === account &&
        "nonce" in proposal &&
        proposal.nonce === nonce
      );
    },
    zrem([key, message]: unknown[]) {
      if (key !== "proposals" || typeof message !== "string") return false;
      const payload = deserialize(message);
      if (typeof payload !== "object" || payload === null) return false;
      return "account" in payload && payload.account === account && "nonce" in payload && payload.nonce === nonce;
    },
  };
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
