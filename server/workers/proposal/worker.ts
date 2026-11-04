import { captureException, setContext, startSpan, withScope } from "@sentry/node";
import { Mutex } from "async-mutex";
import { UnrecoverableError } from "bullmq";
import * as v from "valibot";
import {
  ContractFunctionExecutionError,
  encodeErrorResult,
  formatUnits,
  keccak256,
  toHex,
  type LocalAccount,
} from "viem";

import {
  auditorAbi,
  exaPluginAbi,
  exaPluginAddress,
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

import { attempts, legacyExaPluginAbi, name, Proposal, Withdraw, type Job } from "./job";
import createQueue from "./queue";
import t, { f } from "../../i18n";
import { own } from "../../supervise";
import ensClient from "../../utils/ensClient";
import publicClient from "../../utils/publicClient";
import revertFingerprint from "../../utils/revertFingerprint";
import createWallet from "../../utils/wallet";
import createWorker from "../worker";

import type createOnesignal from "../../utils/onesignal";
import type { Redis } from "ioredis";

export default function worker({
  bullmq,
  executor,
  onesignal,
}: {
  bullmq: Redis;
  executor: LocalAccount;
  onesignal: ReturnType<typeof createOnesignal>;
}) {
  const wallet = createWallet(executor);
  const queue = createQueue(bullmq);
  const mutexes = new Map<Address, Mutex>();

  function notify(account: Address, market: Address, receiver: Address, amount: bigint) {
    return startSpan(
      { name: "send withdraw notification", op: "notification.send", attributes: { account, receiver } },
      () =>
        Promise.all([
          publicClient.readContract({ address: market, abi: marketAbi, functionName: "decimals" }),
          publicClient.readContract({ address: market, abi: marketAbi, functionName: "symbol" }),
          ensClient.getEnsName({ address: receiver }).catch(() => null),
        ]).then(([decimals, symbol, ensName]) =>
          onesignal.sendPushNotification({
            userId: account,
            headings: t("Withdraw completed"),
            contents: t("{{amount}} {{symbol}} sent to {{recipient}}", {
              amount: f(formatUnits(amount, decimals)),
              symbol: symbol.slice(3),
              recipient: ensName ?? shortenHex(receiver),
            }),
          }),
        ),
    ).catch((error: unknown) => captureException(error));
  }

  async function execute(proposal: v.InferOutput<typeof Proposal>) {
    const { account, amount, data, market, nonce, proposalType, retryCount } = proposal;
    const context = { account, nonce: Number(nonce), proposalType: ProposalType[proposalType], retryCount };
    const skipNonce = async () =>
      wallet.exaSend(
        { name: "exa.nonce", op: "exa.nonce", attributes: { account } },
        {
          address: account,
          functionName: "setProposalNonce",
          args: [nonce + 1n],
          abi: [...exaPluginAbi, ...upgradeableModularAccountAbi, ...proposalManagerAbi],
        },
        { ignore: ["NonceTooLow()"] },
      );
    try {
      await (proposalType === ProposalType.None
        ? skipNonce()
        : wallet.exaSend(
            { name: "exa.execute", op: "exa.execute", attributes: { account } },
            {
              address: account,
              functionName: "executeProposal",
              args: [nonce],
              abi: [
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
              ],
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
    } catch (error: unknown) {
      switch (revertReason(error)) {
        case "NonceTooLow":
        case "NoProposal":
          return;
        case "NotNext": {
          const pendingProposals = await publicClient.readContract({
            address: exaPreviewerAddress,
            functionName: "pendingProposals",
            abi: exaPreviewerAbi,
            args: [account],
          });
          const idleProposals = pendingProposals
            .filter((idle) => idle.nonce <= nonce)
            .map((idle) =>
              v.parse(Proposal, {
                ...idle.proposal,
                timestamp: Number(idle.proposal.timestamp),
                nonce: idle.nonce,
                account,
                unlock: idle.unlock,
                retryCount: retryCount + 1,
              }),
            )
            .toSorted((a, b) => Number(a.nonce - b.nonce));
          setContext("exa", { idleProposals });
          const delay = Math.min(1000 * 2 ** retryCount, 60_000);
          for (const idle of idleProposals) await queue.enqueue(idle, delay);
          return;
        }
        case "Timelocked": {
          const pendingProposals = await publicClient.readContract({
            address: exaPreviewerAddress,
            functionName: "pendingProposals",
            abi: exaPreviewerAbi,
            args: [account],
          });
          const pending = pendingProposals.find((queued) => queued.nonce === nonce);
          let unlock = pending?.unlock;
          if (!unlock) {
            const latest = await publicClient.getBlock();
            unlock = latest.timestamp + 1n;
          }
          await queue.enqueue({ ...proposal, retryCount: retryCount + 1, unlock });
          return;
        }
        default:
          if (error instanceof ContractFunctionExecutionError) {
            try {
              await skipNonce();
              return;
            } catch (nonceError: unknown) {
              captureException(nonceError, {
                level: "error",
                contexts: { proposal: context },
                fingerprint: revertFingerprint(nonceError),
              });
              throw nonceError;
            }
          }
          captureException(error, {
            level: "error",
            contexts: { proposal: context },
            fingerprint: revertFingerprint(error),
          });
          throw error;
      }
    }
    if (proposalType !== ProposalType.Withdraw) return;
    if (market.toLowerCase() === marketWETHAddress.toLowerCase()) {
      await skipNonce().catch((nonceError: unknown) => {
        captureException(nonceError, {
          level: "error",
          contexts: { proposal: context },
          fingerprint: revertFingerprint(nonceError),
        });
      });
    }
    await notify(account, market, v.parse(Address, decodeWithdraw(data)), amount);
  }

  async function withdraw({ account, market, receiver, amount, retryCount }: v.InferOutput<typeof Withdraw>) {
    try {
      const receipt = await wallet.exaSend(
        { name: "exa.execute", op: "exa.execute", attributes: { account } },
        {
          address: account,
          functionName: "withdraw",
          abi: [...legacyExaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, marketAbi[6]],
        },
        { ignore: isTerminalWithdrawReason },
      );
      if (receipt?.status !== "success") return;
    } catch (error: unknown) {
      if (isTerminalWithdrawReason(revertReason(error, { fallback: "unknown", withArguments: true }))) return;
      captureException(error, {
        level: "error",
        contexts: { withdraw: { account, market, receiver, amount: String(amount), retryCount } },
        fingerprint: revertFingerprint(error),
      });
      throw error;
    }
    await notify(account, market, receiver, amount);
  }

  return own(
    createWorker<Job>({
      attempts,
      bullmq,
      concurrency: 10,
      failed(job, error) {
        withScope((scope) => {
          if (job) scope.setUser({ id: job.data.account });
          captureException(error, {
            extra: { account: job?.data.account, attempts: job?.attemptsMade, id: job?.id },
            level: "fatal",
            fingerprint: ["{{ default }}", "proposal.exhausted", ...revertFingerprint(error).slice(1)],
            tags: { queue: name, job: job?.name },
          });
        });
      },
      name,
      ready: wallet
        .readContract({
          address: exaPluginAddress,
          functionName: "hasRole",
          args: [keccak256(toHex("KEEPER_ROLE")), executor.address],
          abi: exaPluginAbi,
        })
        .then((keeper) => {
          if (!keeper) throw new Error("executor is not keeper");
        }),
      process: (job, span) =>
        withScope(async (scope) => {
          const parsed = v.safeParse(v.union([Proposal, Withdraw]), job.data);
          if (!parsed.success) {
            throw Object.assign(new UnrecoverableError("invalid job data"), { cause: new v.ValiError(parsed.issues) });
          }
          const message = parsed.output;
          scope.setUser({ id: message.account });
          span.setAttributes({
            account: message.account,
            amount: String(message.amount),
            market: message.market,
            unlock: Number(message.unlock),
            "messaging.message.retry.count": message.retryCount,
            "messaging.message.receive.latency": Date.now() - Number(message.unlock) * 1000,
          });
          if (!("nonce" in message)) {
            span.setAttribute("receiver", message.receiver);
            return withdraw(message);
          }
          span.setAttributes({ data: message.data, nonce: Number(message.nonce), proposalType: message.proposalType });
          const mutex = mutexes.get(message.account) ?? new Mutex();
          mutexes.set(message.account, mutex);
          return startSpan(
            {
              name: "acquire mutex",
              op: "lock.acquire",
              attributes: { account: message.account, "lock.name": `proposal:${message.account}` },
            },
            () =>
              mutex
                .runExclusive(() => execute(message), -Number(message.nonce))
                .finally(() => {
                  if (!mutex.isLocked()) mutexes.delete(message.account);
                }),
          );
        }),
    }),
    () => queue.close(),
  );
}

const isTerminalWithdrawReason = (reason: string) =>
  reason === "InsufficientAccountLiquidity()" ||
  reason === "RuntimeValidationFunctionMissing(0x3ccfd60b)" ||
  (reason.startsWith("PreExecHookReverted(") &&
    reason.endsWith(`,${encodeErrorResult({ errorName: "NoProposal", abi: proposalManagerAbi })})`));
