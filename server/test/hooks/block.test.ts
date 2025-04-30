import "../mocks/sentry";
import "../mocks/alchemy";
import "../mocks/onesignal";
import "../mocks/redis";
import "../mocks/deployments";

import ProposalType from "@exactly/common/ProposalType";
import deriveAddress from "@exactly/common/deriveAddress";
import chain from "@exactly/common/generated/chain";
import { testClient } from "hono/testing";
import {
  createWalletClient,
  decodeAbiParameters,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  http,
  maxUint256,
  nonceManager,
  padHex,
  parseEventLogs,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
  type Log,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";

import {
  auditorAbi,
  exaPluginAbi,
  issuerCheckerAbi,
  marketAbi,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
} from "../../generated/contracts";
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
      await anvilClient.mine({ blocks: 1, interval: 10 * 60 });
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
        vi.waitUntil(() => waitForTransactionReceipt.mock.settledResults.length >= 2, 26_666),
      ]);

      const [withdrawReceipt, anotherWithdrawReceipt] = waitForTransactionReceipt.mock.settledResults;

      expect(withdrawReceipt).toBeDefined();
      expect(anotherWithdrawReceipt).toBeDefined();

      expect(
        withdrawReceipt && withdrawReceipt.type === "fulfilled"
          ? usdcToAddress(
              withdrawReceipt.value,
              decodeAbiParameters([{ name: "receiver", type: "address" }], withdraw.args.data)[0],
            )
          : 0n,
      ).toBe(withdraw.args.amount);

      expect(
        anotherWithdrawReceipt && anotherWithdrawReceipt.type === "fulfilled"
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
      await anvilClient.mine({ blocks: 1, interval: 10 * 60 });
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
        vi.waitUntil(() => waitForTransactionReceipt.mock.settledResults.length > 0, 26_666),
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
      await anvilClient.mine({ blocks: 1, interval: 10 * 60 });
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

      await vi.waitUntil(() => waitForTransactionReceipt.mock.settledResults.length > 0);
      const withdrawReceipt = waitForTransactionReceipt.mock.settledResults[0];
      const newNonce =
        withdrawReceipt && withdrawReceipt.type === "fulfilled" && withdrawReceipt.value.logs.length === 1
          ? withdrawReceipt.value.logs.map(({ topics, data }) =>
              decodeEventLog({ abi: proposalManagerAbi, eventName: "ProposalNonceSet", topics, data }),
            )[0]?.args.nonce
          : -1n;

      expect(newNonce).toBe(revert.args.nonce + 1n);
    });
  });

  describe("with none proposal", () => {
    beforeEach(async () => {
      const hash = await execute(
        encodeFunctionData({
          abi: exaPluginAbi,
          functionName: "propose",
          args: [inject("MarketUSDC"), 1n, ProposalType.None, "0x"],
        }),
      );
      await anvilClient.mine({ blocks: 1, interval: 10 * 60 });
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
        vi.waitUntil(() => waitForTransactionReceipt.mock.settledResults.length > 0, 6666),
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
      await anvilClient.mine({ blocks: 1, interval: 10 * 60 });
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
        vi.waitUntil(() => waitForTransactionReceipt.mock.settledResults.length >= 5, 26_666),
      ]);

      const withdrawReceipt = waitForTransactionReceipt.mock.settledResults[3];
      const idleProposalReceipt = waitForTransactionReceipt.mock.settledResults[1];

      expect(withdrawReceipt).toBeDefined();
      expect(idleProposalReceipt).toBeDefined();

      expect(
        withdrawReceipt && withdrawReceipt.type === "fulfilled"
          ? usdcToAddress(
              withdrawReceipt.value,
              decodeAbiParameters([{ name: "receiver", type: "address" }], withdraw.args.data)[0],
            )
          : 0n,
      ).toBe(withdraw.args.amount);

      expect(
        idleProposalReceipt && idleProposalReceipt.type === "fulfilled"
          ? usdcToAddress(
              idleProposalReceipt.value,
              decodeAbiParameters([{ name: "receiver", type: "address" }], idle.args.data)[0],
            )
          : 0n,
      ).toBe(idle.args.amount);
    });
  });
});

const blockPayload = {
  header: undefined,
  json: {
    type: "GRAPHQL" as const,
    event: { data: { block: { number: 666, timestamp: Math.floor(Date.now() / 1000), logs: [] } } },
  },
};

const withdrawProposal = {
  header: undefined,
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
      network: "OPT_SEPOLIA",
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
