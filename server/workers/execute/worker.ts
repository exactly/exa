import { captureException, setContext, withScope } from "@sentry/node";
import * as v from "valibot";
import { ContractFunctionExecutionError, formatUnits, type LocalAccount } from "viem";

import {
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

import { attempts, name, Proposal, type Job } from "./job";
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
    failed(job, error) {
      withScope((scope) => {
        if (job) scope.setUser({ id: job.data.account });
        captureException(error, {
          contexts: job && {
            proposal: {
              account: job.data.account,
              nonce: Number(job.data.nonce),
              proposalType: ProposalType[job.data.proposalType],
              retryCount: job.data.retryCount + job.attemptsMade,
            },
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
      const proposal = v.parse(Proposal, {
        ...job.data,
        amount: BigInt(job.data.amount),
        nonce: BigInt(job.data.nonce),
        unlock: BigInt(job.data.unlock),
      });
      const { account, amount, data, market, nonce, proposalType, timestamp, unlock } = proposal;
      const retryCount = proposal.retryCount + job.attemptsMade;
      span.setAttributes({
        account,
        amount: String(amount),
        data,
        market,
        nonce: Number(nonce),
        proposalType,
        timestamp,
        unlock: Number(unlock),
      });
      return withScope(async (scope) => {
        scope.setUser({ id: account });
        scope.setContext("proposal", {
          account,
          nonce: Number(nonce),
          proposalType: ProposalType[proposalType],
          retryCount,
        });
        async function skipNonce() {
          await wallet.exaSend(
            { name: "exa.nonce", op: "exa.nonce", attributes: { account } },
            {
              address: account,
              functionName: "setProposalNonce",
              args: [nonce + 1n],
              abi: [...exaPluginAbi, ...upgradeableModularAccountAbi, ...proposalManagerAbi],
            },
            { ignore: ["NonceTooLow()"] },
          );
        }
        try {
          await (proposalType === ProposalType.None
            ? skipNonce()
            : wallet.exaSend(
                { name: "exa.execute", op: "exa.execute", attributes: { account } },
                {
                  address: account,
                  functionName: "executeProposal",
                  args: [nonce],
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
          if (proposalType !== ProposalType.Withdraw) return;
          if (market.toLowerCase() === marketWETHAddress.toLowerCase()) {
            await skipNonce().catch((error: unknown) => {
              captureException(error, {
                contexts: {
                  proposal: { account, nonce: Number(nonce), proposalType: ProposalType[proposalType], retryCount },
                },
                fingerprint: revertFingerprint(error),
                level: "error",
              });
            });
          }
          const receiver = v.parse(Address, decodeWithdraw(data));
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
                .filter(({ nonce: pendingNonce }) => pendingNonce <= nonce)
                .map((pendingProposal) =>
                  v.parse(Proposal, {
                    ...pendingProposal.proposal,
                    timestamp: Number(pendingProposal.proposal.timestamp),
                    nonce: pendingProposal.nonce,
                    account,
                    unlock: pendingProposal.unlock,
                    retryCount: retryCount + 1,
                  }),
                )
                .toSorted((a, b) => Number(a.nonce - b.nonce));
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
              const queued = pending.find(({ nonce: pendingNonce }) => pendingNonce === nonce);
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
                      contexts: {
                        proposal: {
                          account,
                          nonce: Number(nonce),
                          proposalType: ProposalType[proposalType],
                          retryCount,
                        },
                      },
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
