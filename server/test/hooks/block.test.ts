import "../mocks/alchemy";
import "../mocks/deployments";
import "../mocks/onesignal";
import "../mocks/redis";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { testClient } from "hono/testing";
import {
  createWalletClient,
  decodeAbiParameters,
  decodeEventLog,
  encodeAbiParameters,
  encodeErrorResult,
  encodeFunctionData,
  erc20Abi,
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
import ProposalType from "@exactly/common/ProposalType";
import deploy from "@exactly/plugin/deploy.json";

import app from "../../hooks/block";
import publicClient from "../../utils/publicClient";
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
        vi.waitUntil(
          () => waitForTransactionReceipt.mock.settledResults.filter(({ type }) => type !== "incomplete").length >= 2,
          26_666,
        ),
      ]);

      const [withdrawReceipt, anotherWithdrawReceipt] = waitForTransactionReceipt.mock.settledResults;

      expect(withdrawReceipt).toBeDefined();
      expect(anotherWithdrawReceipt).toBeDefined();

      expect(
        withdrawReceipt?.type === "fulfilled"
          ? usdcToAddress(
              withdrawReceipt.value,
              decodeAbiParameters([{ name: "receiver", type: "address" }], withdraw.args.data)[0],
            )
          : 0n,
      ).toBe(withdraw.args.amount);

      expect(
        anotherWithdrawReceipt?.type === "fulfilled"
          ? usdcToAddress(
              anotherWithdrawReceipt.value,
              decodeAbiParameters([{ name: "receiver", type: "address" }], anotherWithdraw.args.data)[0],
            )
          : 0n,
      ).toBe(anotherWithdraw.args.amount);
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
                logs: [
                  {
                    topics: revert.topics,
                    data: revert.data,
                    account: { address: revert.address },
                  },
                ],
              },
            },
          },
        },
      });

      await vi.waitUntil(
        () => waitForTransactionReceipt.mock.settledResults.some(({ type }) => type !== "incomplete"),
        26_666,
      );
      const withdrawReceipt = waitForTransactionReceipt.mock.settledResults[0];
      const newNonce =
        withdrawReceipt?.type === "fulfilled" && withdrawReceipt.value.logs.length === 1
          ? withdrawReceipt.value.logs.map(({ topics, data }) =>
              decodeEventLog({ abi: proposalManagerAbi, eventName: "ProposalNonceSet", topics, data }),
            )[0]?.args.nonce
          : -1n;

      expect(newNonce).toBe(revert.args.nonce + 1n);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ fingerprint: ["{{ default }}", "execution reverted"] }),
      );
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
        expect.objectContaining({ fingerprint: ["{{ default }}", "WrappedError", "0x931997cf"] }),
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
        expect.objectContaining({ fingerprint: ["{{ default }}", "unknown"] }),
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
        expect.objectContaining({ fingerprint: ["{{ default }}", "unknown"] }),
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
        expect.objectContaining({ fingerprint: ["{{ default }}", "0x12345678"] }),
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
                  logs: [
                    { topics: withdraw.topics, data: withdraw.data, account: { address: withdraw.address } },
                    { topics: another.topics, data: another.data, account: { address: another.address } },
                  ],
                },
              },
            },
          },
        }),
        vi.waitUntil(
          () => waitForTransactionReceipt.mock.settledResults.filter(({ type }) => type !== "incomplete").length >= 5,
          26_666,
        ),
      ]);

      const withdrawReceipt = waitForTransactionReceipt.mock.settledResults[3];
      const idleProposalReceipt = waitForTransactionReceipt.mock.settledResults[1];

      expect(withdrawReceipt).toBeDefined();
      expect(idleProposalReceipt).toBeDefined();

      expect(
        withdrawReceipt?.type === "fulfilled"
          ? usdcToAddress(
              withdrawReceipt.value,
              decodeAbiParameters([{ name: "receiver", type: "address" }], withdraw.args.data)[0],
            )
          : 0n,
      ).toBe(withdraw.args.amount);

      expect(
        idleProposalReceipt?.type === "fulfilled"
          ? usdcToAddress(
              idleProposalReceipt.value,
              decodeAbiParameters([{ name: "receiver", type: "address" }], idle.args.data)[0],
            )
          : 0n,
      ).toBe(idle.args.amount);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ContractFunctionExecutionError", functionName: "executeProposal" }),
        expect.objectContaining({ fingerprint: ["{{ default }}", "NotNext"] }),
      );
    });
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

function usdcToAddress(purchaseReceipt: TransactionReceipt, address: Address) {
  return purchaseReceipt.logs
    .filter((l) => l.address.toLowerCase() === inject("USDC").toLowerCase())
    .map((l) => decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics: l.topics, data: l.data }))
    .filter((l) => l.args.to === address)
    .reduce((total, l) => total + l.args.value, 0n);
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
