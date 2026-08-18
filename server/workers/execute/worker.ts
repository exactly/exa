import { captureException, setContext, withScope } from "@sentry/node";
import { deserialize } from "@wagmi/core";
import * as v from "valibot";
import {
  BaseError,
  CallExecutionError,
  ContractFunctionExecutionError,
  encodeErrorResult,
  ExecutionRevertedError,
  formatUnits,
  type Address as AddressType,
  type LocalAccount,
} from "viem";
import { optimismSepolia } from "viem/chains";

import chain, {
  auditorAbi,
  exaPluginAbi,
  exaPreviewerAbi,
  exaPreviewerAddress,
  marketAbi,
  marketWETHAddress,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import ProposalType, { decodeWithdraw } from "@exactly/common/ProposalType";
import revertReason from "@exactly/common/revertReason";
import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";

import { attempts, name, Proposal, Withdraw, type Job } from "./job";
import createQueue from "./queue";
import t, { f } from "../../i18n";
import ensClient from "../../utils/ensClient";
import createOnesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import revertFingerprint from "../../utils/revertFingerprint";
import createWallet from "../../utils/wallet";
import createWorker, { connect } from "../worker";

export default function worker({
  executor,
  onesignalKey,
  redisUrl,
}: {
  executor: LocalAccount;
  onesignalKey: string;
  redisUrl: string;
}) {
  const bullmq = connect(redisUrl);
  const proposals = createQueue(bullmq);
  const onesignal = createOnesignal(onesignalKey);
  const wallet = createWallet(executor);
  return createWorker<Job>({
    attempts,
    bullmq,
    close: () => proposals.close(),
    ready: bullmq
      .zrange("withdraw", 0, Infinity, "BYSCORE")
      .then(async (messages) => {
        await Promise.all(
          messages.map(async (message) => {
            await proposals.enqueue({
              ...v.parse(v.omit(Withdraw, ["functionName"]), deserialize(message)),
              functionName: "withdraw",
            });
            await bullmq.zrem("withdraw", message);
          }),
        );
      })
      .catch((error: unknown) => {
        captureException(error);
      }),
    failed(job, error) {
      withScope((scope) => {
        if (job) scope.setUser({ id: job.data.account });
        captureException(error, {
          contexts: job && {
            proposal: context(job.data, job.data.retryCount + job.attemptsMade),
          },
          extra: { attempts: job?.attemptsMade, id: job?.id },
          fingerprint: revertFingerprint(error),
          level: "error",
          tags: { queue: name, job: job?.name },
        });
      });
    },
    name,
    process(job, span) {
      const proposal = v.parse(
        Proposal,
        job.data.functionName === "executeProposal"
          ? {
              ...job.data,
              amount: BigInt(job.data.amount),
              nonce: BigInt(job.data.nonce),
              unlock: BigInt(job.data.unlock),
            }
          : { ...job.data, amount: BigInt(job.data.amount), unlock: BigInt(job.data.unlock) },
      );
      const { account, amount, market, timestamp, unlock } = proposal;
      const retryCount = proposal.retryCount + job.attemptsMade;
      span.setAttributes({
        account,
        amount: String(amount),
        functionName: proposal.functionName,
        market,
        ...(proposal.functionName === "executeProposal"
          ? { data: proposal.data, nonce: Number(proposal.nonce), proposalType: proposal.proposalType }
          : { receiver: proposal.receiver }),
        timestamp,
        unlock: Number(unlock),
      });
      return withScope(async (scope) => {
        scope.setUser({ id: account });
        const details = context(proposal, retryCount);
        scope.setContext("proposal", details);
        async function skipNonce() {
          if (proposal.functionName !== "executeProposal") return;
          await wallet.exaSend(
            { name: "exa.nonce", op: "exa.nonce", attributes: { account } },
            {
              address: account,
              functionName: "setProposalNonce",
              args: [proposal.nonce + 1n],
              abi: [...exaPluginAbi, ...upgradeableModularAccountAbi, ...proposalManagerAbi],
            },
            { ignore: ["NonceTooLow()"] },
          );
        }
        try {
          let receiver: AddressType;
          if (proposal.functionName === "withdraw") {
            const receipt = await wallet.exaSend(
              { name: "exa.execute", op: "exa.execute", attributes: { account } },
              { address: account, functionName: "withdraw", abi: legacyAccountAbi },
              { ignore: isTerminalWithdrawReason },
            );
            if (receipt?.status !== "success") return;
            receiver = proposal.receiver;
          } else {
            await (proposal.proposalType === ProposalType.None
              ? skipNonce()
              : wallet.exaSend(
                  { name: "exa.execute", op: "exa.execute", attributes: { account } },
                  {
                    address: account,
                    functionName: "executeProposal",
                    args: [proposal.nonce],
                    abi: accountAbi,
                  },
                  {
                    level: (reason, error) =>
                      reason === "NonceTooLow()" || reason === "NoProposal()"
                        ? false
                        : error instanceof ContractFunctionExecutionError
                          ? "warning"
                          : "error",
                  },
                ));
            if (proposal.proposalType !== ProposalType.Withdraw) return;
            if (market.toLowerCase() === marketWETHAddress.toLowerCase()) {
              await skipNonce().catch((error: unknown) => {
                captureException(error, {
                  contexts: { proposal: details },
                  fingerprint: revertFingerprint(error),
                  level: "error",
                });
              });
            }
            receiver = v.parse(Address, decodeWithdraw(proposal.data));
          }
          await Promise.all([
            publicClient.readContract({ address: market, abi: marketAbi, functionName: "decimals" }),
            publicClient.readContract({ address: market, abi: marketAbi, functionName: "symbol" }),
            ensClient.getEnsName({ address: receiver }).catch(() => null),
          ])
            .then(([decimals, symbol, ensName]) =>
              onesignal.sendPushNotification({
                userId: account,
                headings: t("Withdraw completed"),
                contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
                  amount: f(formatUnits(amount, decimals)),
                  symbol: symbol.slice(3),
                  recipient: ensName ?? shortenHex(receiver),
                }),
              }),
            )
            .catch((error: unknown) => captureException(error));
        } catch (error: unknown) {
          if (proposal.functionName === "withdraw") {
            if (isTerminalWithdrawReason(revertReason(error, { fallback: "unknown", withArguments: true }))) return;
            if (
              chain.id === optimismSepolia.id &&
              error instanceof BaseError &&
              error.cause instanceof CallExecutionError &&
              error.cause.cause instanceof ExecutionRevertedError
            )
              return;
            throw error;
          }
          switch (revertReason(error)) {
            case "NonceTooLow":
            case "NoProposal":
              return;
            case "NotNext": {
              const pending = await publicClient.readContract({
                address: exaPreviewerAddress,
                functionName: "pendingProposals",
                abi: exaPreviewerAbi,
                args: [account],
              });
              const idle = pending
                .filter(({ nonce: pendingNonce }) => pendingNonce <= proposal.nonce)
                .toSorted((a, b) => Number(a.nonce - b.nonce))
                .map((pendingProposal) =>
                  v.parse(Proposal, {
                    ...pendingProposal.proposal,
                    functionName: "executeProposal",
                    timestamp: Number(pendingProposal.proposal.timestamp),
                    nonce: pendingProposal.nonce,
                    account,
                    unlock: pendingProposal.unlock,
                    retryCount: retryCount + 1,
                  }),
                );
              setContext("exa", { idleProposals: idle });
              for (const pendingProposal of idle) await proposals.enqueue(pendingProposal);
              return;
            }
            case "Timelocked": {
              const pending = await publicClient.readContract({
                address: exaPreviewerAddress,
                functionName: "pendingProposals",
                abi: exaPreviewerAbi,
                args: [account],
              });
              const queued = pending.find(({ nonce: pendingNonce }) => pendingNonce === proposal.nonce);
              await proposals.enqueue({
                ...proposal,
                retryCount: retryCount + 1,
                unlock: queued?.unlock ?? (await publicClient.getBlock().then((block) => block.timestamp + 1n)),
              });
              return;
            }
            default:
              if (error instanceof ContractFunctionExecutionError) {
                const skipped = await skipNonce()
                  .then(() => true)
                  .catch((nonceError: unknown) => {
                    captureException(nonceError, {
                      contexts: { proposal: details },
                      fingerprint: revertFingerprint(nonceError),
                      level: "error",
                    });
                    return false;
                  });
                if (skipped) return;
              }
              throw error;
          }
        }
      });
    },
  });
}

function context(proposal: Job | Proposal, retryCount: number) {
  return {
    account: proposal.account,
    amount: String(proposal.amount),
    functionName: proposal.functionName,
    market: proposal.market,
    ...(proposal.functionName === "executeProposal"
      ? { nonce: Number(proposal.nonce), proposalType: ProposalType[proposal.proposalType] }
      : { receiver: proposal.receiver }),
    retryCount,
  };
}

const isTerminalWithdrawReason = (reason: string) =>
  reason === "InsufficientAccountLiquidity()" ||
  reason === "RuntimeValidationFunctionMissing(0x3ccfd60b)" ||
  (reason.startsWith("PreExecHookReverted(") &&
    reason.endsWith(`,${encodeErrorResult({ errorName: "NoProposal", abi: proposalManagerAbi })})`));

const accountAbi = [
  ...exaPluginAbi,
  ...upgradeableModularAccountAbi,
  ...proposalManagerAbi,
  ...auditorAbi,
  ...marketAbi,
  { type: "error", name: "ExpiredTransaction", inputs: [] },
  { type: "error", name: "InsufficientAmountOut", inputs: [] },
  {
    type: "error",
    name: "MinimalOutputBalanceViolation",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
  },
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

const legacyAccountAbi = [
  { type: "function", name: "withdraw", inputs: [], outputs: [], stateMutability: "nonpayable" },
  { type: "error", name: "NoProposal", inputs: [] },
  ...upgradeableModularAccountAbi,
  ...auditorAbi,
  marketAbi[6],
] as const;
