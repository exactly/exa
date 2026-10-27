import { vValidator } from "@hono/valibot-validator";
import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import {
  captureException,
  continueTrace,
  getActiveSpan,
  getTraceData,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  setContext,
  setExtra,
  startSpan,
  withScope,
} from "@sentry/node";
import { deserialize, serialize } from "@wagmi/core";
import { Mutex } from "async-mutex";
import createDebug from "debug";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { v5 } from "uuid";
import * as v from "valibot";
import {
  BaseError,
  CallExecutionError,
  ContractFunctionExecutionError,
  ContractFunctionZeroDataError,
  decodeEventLog,
  encodeErrorResult,
  ExecutionRevertedError,
  formatUnits,
  getAbiItem,
  isAddressEqual,
  parseEventLogs,
  toEventSelector,
  type LocalAccount,
} from "viem";
import { entryPoint06Abi, entryPoint06Address } from "viem/account-abstraction";
import { optimism, optimismSepolia } from "viem/chains";

import chain, {
  auditorAbi,
  exaAccountFactoryAbi,
  exaPluginAbi,
  exaPluginAddress,
  exaPreviewerAbi,
  exaPreviewerAddress,
  factories,
  marketAbi,
  marketUSDCAddress,
  marketWETHAddress,
  proposalManagerAbi,
  proposalManagerAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import ProposalType, { decodeWithdraw } from "@exactly/common/ProposalType";
import revertReason from "@exactly/common/revertReason";
import shortenHex from "@exactly/common/shortenHex";
import { Address, Hash, Hex } from "@exactly/common/validation";

import { credentials } from "../database/schema";
import t, { f } from "../i18n";
import { headerValidator } from "../utils/alchemy";
import appOrigin from "../utils/appOrigin";
import ensClient from "../utils/ensClient";
import publicClient from "../utils/publicClient";
import pay from "../utils/ramps/pay";
import revertFingerprint from "../utils/revertFingerprint";
import ServiceError from "../utils/ServiceError";
import validatorHook from "../utils/validatorHook";
import createWallet from "../utils/wallet";

import type * as schema from "../database/schema";
import type createAlchemy from "../utils/alchemy";
import type createOnesignal from "../utils/onesignal";
import type createPersona from "../utils/persona";
import type createManteca from "../utils/ramps/manteca";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";

const debug = createDebug("exa:block");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default function hook({
  alchemy,
  blockKey,
  chainId = chain.id,
  database,
  executor,
  manteca,
  onesignal,
  persona,
  redis,
}: {
  alchemy: ReturnType<typeof createAlchemy>;
  blockKey?: string;
  chainId?: number;
  database: NodePgDatabase<typeof schema>;
  executor: LocalAccount;
  manteca: ReturnType<typeof createManteca>;
  onesignal: ReturnType<typeof createOnesignal>;
  persona: ReturnType<typeof createPersona>;
  redis: Redis;
}) {
  const wallet = createWallet(executor);
  const mutexes = new Map<Address, Mutex>();
  function createMutex(address: Address) {
    const mutex = new Mutex();
    mutexes.set(address, mutex);
    return mutex;
  }

  let emitters: Promise<Set<Address>> | undefined;
  function proposalEmitters() {
    emitters ??= discoverEmitters(chainId).catch((error: unknown) => {
      emitters = undefined;
      throw error;
    });
    return emitters;
  }

  if (!blockKey) debug("missing alchemy block key");
  const signingKeys = new Set(blockKey && [blockKey]);
  const ready = Promise.all([
    redis
      .zrange("withdraw", 0, Infinity, "BYSCORE")
      .then((messages) => {
        for (const message of messages) scheduleWithdraw(message);
      })
      .catch((error: unknown) => captureException(error)),
    redis
      .zrange("proposals", 0, Infinity, "BYSCORE")
      .then((messages) => {
        for (const message of messages) scheduleMessage(message);
      })
      .catch((error: unknown) => captureException(error)),
    initializeAlchemy(alchemy, signingKeys, proposalEmitters).catch((error: unknown) => {
      if (signingKeys.size === 0) throw error;
      captureException(error, { level: "warning" });
    }),
  ]);
  const app = new Hono().post(
    "/",
    headerValidator(signingKeys),
    vValidator(
      "json",
      v.object({
        type: v.literal("GRAPHQL"),
        event: v.object({
          data: v.object({
            block: v.object({
              number: v.optional(v.number()), // TODO remove optional after migration
              timestamp: v.number(),
              logs: v.array(
                v.object({
                  topics: v.tupleWithRest([Hash], Hash),
                  data: Hex,
                  account: v.object({ address: Address }),
                  transaction: v.optional(v.object({ hash: Hash })),
                }),
              ),
            }),
          }),
        }),
      }),
      validatorHook({
        code: "bad alchemy",
        status: 200,
        filter: ({ event }) => event.data.block.logs.length > 0,
        debug,
      }),
    ),
    async (c) => {
      getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "alchemy.block");
      const { number, timestamp, logs } = c.req.valid("json").event.data.block;

      if (logs.length === 0) {
        setExtra("exa.ignore", true);
        return c.json({}, 200);
      }

      const outflows = logs
        .filter(
          ({ topics, account }) => topics[0] === withdrawTopic && isAddressEqual(account.address, marketUSDCAddress),
        )
        .map(({ topics, data, transaction }) => ({
          transaction,
          ...decodeEventLog({ abi: marketAbi, eventName: "Withdraw", topics, data }),
        }));
      async function settle() {
        if (outflows.length === 0) return [];
        const settlements = Object.values(await manteca.getSettlements());
        return outflows.filter(({ args }) =>
          settlements.some((settlement) => isAddressEqual(settlement, args.receiver)),
        );
      }
      const payments = logs.every(({ topics }) => topics[0] === withdrawTopic) ? await settle() : undefined;
      if (payments?.length === 0) {
        setExtra("exa.ignore", true);
        return c.json({}, 200);
      }
      setContext("alchemy", await c.req.json());

      const trusted = await proposalEmitters();
      const proposalsBySignature = logs.reduce((accumulator, event) => {
        if (!trusted.has(event.account.address)) {
          debug("ignored log from %s", event.account.address);
          return accumulator;
        }
        const signature = event.topics[0];
        if (!accumulator.has(signature)) {
          accumulator.set(signature, []);
        }
        accumulator.get(signature)?.push(event);
        return accumulator;
      }, new Map<string, typeof logs>());

      // TODO use .filter((event) => event.eventName === "Proposed") after migration
      const proposed =
        proposalsBySignature
          .get("0x4cf7794d9c19185f7d95767c53e511e2e67ae50f68ece9c9079c6ae83403a3e7")
          ?.map(({ topics, data }) => decodeEventLog({ topics, data, abi: [...exaPluginAbi, ...proposalManagerAbi] }))
          .map((event) => {
            const p = v.safeParse(Proposal, { ...event.args, timestamp });
            if (p.success) return p.output;
            captureException(p.issues, { level: "error" });
            return null;
          })
          .filter((x) => x !== null)
          .reduce((accumulator, event) => {
            const account = event.account;
            if (!accumulator.has(account)) {
              accumulator.set(account, []);
            }
            accumulator.get(account)?.push(event);
            return accumulator;
          }, new Map<string, v.InferOutput<typeof Proposal>[]>()) ??
        new Map<string, v.InferOutput<typeof Proposal>[]>();

      const withdraws =
        proposalsBySignature
          .get("0x0c652a21d96e4efed065c3ef5961e4be681be99b95dd55126669ae9be95767e0")
          ?.map(({ topics, data }) => decodeEventLog({ topics, data, abi: legacyExaPluginAbi })) ?? [];

      const accounts = [...new Set([...proposed.keys(), ...withdraws.map(({ args }) => args.account)])];
      const credentialed =
        accounts.length > 0
          ? await database.query.credentials
              .findMany({ columns: { account: true }, where: inArray(credentials.account, accounts) })
              .then((rows) => new Set(rows.map(({ account }) => account)))
          : new Set<string>();
      const known = new Set([
        ...credentialed,
        ...(await initializedAccounts(
          accounts.filter((account) => !credentialed.has(account)),
          number,
        )),
      ]);
      const unknown = accounts.filter((account) => !known.has(account));
      if (unknown.length > 0) getActiveSpan()?.setAttribute("exa.unknown", unknown);
      const proposalsByAccount = new Map(proposed.entries().filter(([account]) => known.has(account)));
      const oldWithdraws = withdraws.filter(({ args }) => known.has(args.account));

      const failures: unknown[] = [];
      await Promise.all([
        ...proposalsByAccount.values().map(async (ps) => {
          for (const proposal of ps.toSorted((a, b) => Number(a.nonce - b.nonce))) await scheduleProposal(proposal);
        }),
        ...oldWithdraws.map(async (event) => {
          const withdraw = v.parse(Withdraw, { ...event.args, timestamp });
          return startSpan(
            {
              name: "schedule withdraw",
              op: "queue.publish",
              attributes: {
                account: withdraw.account,
                market: withdraw.market,
                receiver: withdraw.receiver,
                amount: String(withdraw.amount),
                unlock: Number(withdraw.unlock),
                "messaging.system": "redis",
                "messaging.operation.type": "send",
                "messaging.destination.name": "withdraw",
                "messaging.message.id": withdraw.id,
              },
            },
            async () => {
              const { "sentry-trace": sentryTrace, baggage: sentryBaggage } = getTraceData();
              withdraw.sentryTrace = sentryTrace;
              withdraw.sentryBaggage = sentryBaggage;
              const message = serialize(withdraw);
              getActiveSpan()?.setAttribute("messaging.message.body.size", Buffer.byteLength(message));
              const added = await redis.zadd("withdraw", Number(event.args.unlock), message);
              if (added) scheduleWithdraw(message);
              return added;
            },
          );
        }),
        Promise.resolve(payments ?? settle()).then((settled) =>
          Promise.all(
            new Set(settled.map(({ transaction }) => transaction?.hash)).values().map(async (hash) => {
              const payers = new Set<string>();
              if (hash) {
                const receipt = await publicClient.getTransactionReceipt({ hash });
                const operations = parseEventLogs({
                  abi: entryPoint06Abi,
                  eventName: "UserOperationEvent",
                  logs: receipt.logs,
                }).filter(({ address }) => isAddressEqual(address, entryPoint06Address));
                for (const [index, { args, logIndex }] of operations.entries()) {
                  if (!settled.some((p) => p.transaction?.hash === hash && isAddressEqual(p.args.owner, args.sender))) {
                    continue;
                  }
                  const credential = await database.query.credentials.findFirst({
                    where: eq(credentials.account, args.sender),
                    columns: { id: true },
                  });
                  if (!credential) continue;
                  payers.add(args.sender);
                  const start = operations[index - 1]?.logIndex ?? -1;
                  await pay(manteca, persona, credential.id, {
                    ...args,
                    sender: v.parse(Address, args.sender),
                    logs: receipt.logs.filter((log) => log.logIndex > start && log.logIndex < logIndex),
                  }).catch((error: unknown) => {
                    failures.push(error);
                    captureException(error, {
                      level: "error",
                      contexts: { payment: { account: args.sender, userOpHash: args.userOpHash } },
                    });
                  });
                }
              }
              for (const { transaction, args } of settled) {
                if (transaction?.hash !== hash || payers.has(args.owner)) continue;
                captureException(new Error("usdc sent to settlement without qr lock"), {
                  level: "error",
                  contexts: { payment: { account: args.owner, transaction: hash, amount: String(args.assets) } },
                });
              }
            }),
          ),
        ),
      ]);
      return c.json({}, failures.length > 0 ? 500 : 200);
    },
  );

  function scheduleProposal(proposal: v.InferOutput<typeof Proposal>) {
    return startSpan(
      {
        name: "schedule proposal",
        op: "queue.publish",
        attributes: {
          account: proposal.account,
          amount: String(proposal.amount),
          data: proposal.data,
          market: proposal.market,
          nonce: Number(proposal.nonce),
          proposalType: proposal.proposalType,
          timestamp: proposal.timestamp,
          unlock: Number(proposal.unlock),
          "messaging.system": "redis",
          "messaging.operation.type": "send",
          "messaging.destination.name": "proposals",
          "messaging.message.id": proposal.id,
        },
      },
      async () => {
        const { "sentry-trace": sentryTrace, baggage: sentryBaggage } = getTraceData();
        proposal.sentryTrace = sentryTrace;
        proposal.sentryBaggage = sentryBaggage;
        const message = serialize(proposal);
        getActiveSpan()?.setAttribute("messaging.message.body.size", Buffer.byteLength(message));
        const added = await redis.zadd("proposals", Number(proposal.unlock + proposal.nonce), message);
        if (added) scheduleMessage(message);
        return added;
      },
    );
  }

  function scheduleMessage(message: string) {
    const proposal = v.parse(Proposal, deserialize(message));
    const {
      account,
      amount,
      data,
      id,
      market,
      nonce,
      proposalType,
      retryCount,
      sentryBaggage,
      sentryTrace,
      timestamp,
      unlock,
    } = proposal;
    const bodySize = Buffer.byteLength(message);

    const processProposal = () =>
      withScope((scope) => {
        scope.setUser({ id: account });
        scope.setContext("proposal", {
          account,
          nonce: Number(nonce),
          proposalType: ProposalType[proposalType],
          retryCount,
        });
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
        return startSpan({ name: "exa.execute", op: "exa.execute", forceTransaction: true }, (parent) =>
          startSpan(
            {
              name: "execute proposal",
              op: "queue.process",
              attributes: {
                account,
                amount: String(amount),
                data,
                market,
                nonce: Number(nonce),
                proposalType,
                timestamp,
                unlock: Number(unlock),
                "messaging.system": "redis",
                "messaging.operation.type": "process",
                "messaging.destination.name": "proposals",
                "messaging.message.id": id,
                "messaging.message.body.size": bodySize,
                "messaging.message.retry.count": retryCount,
                "messaging.message.receive.latency": Date.now() - Number(unlock) * 1000,
              },
            },
            async () => {
              const receipt = await (proposalType === ProposalType.None
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

              parent.setStatus({ code: SPAN_STATUS_OK });
              if (proposalType === ProposalType.Withdraw || proposalType === ProposalType.Redeem) {
                if (market.toLowerCase() === marketWETHAddress.toLowerCase()) {
                  await skipNonce().catch((nonceError: unknown) => {
                    captureException(nonceError, {
                      level: "error",
                      contexts: {
                        proposal: {
                          account,
                          nonce: Number(nonce),
                          proposalType: ProposalType[proposalType],
                          retryCount,
                        },
                      },
                      fingerprint: revertFingerprint(nonceError),
                    });
                  });
                }
                const receiver = v.parse(Address, decodeWithdraw(data));
                const assets =
                  proposalType === ProposalType.Withdraw
                    ? amount
                    : parseEventLogs({ abi: marketAbi, eventName: "Withdraw", logs: receipt?.logs ?? [] }).find(
                        ({ address, args }) => isAddressEqual(address, market) && isAddressEqual(args.owner, account),
                      )?.args.assets;
                if (assets === undefined) {
                  captureException(new Error("missing withdraw event"), {
                    level: "error",
                    contexts: { proposal: { account, market, nonce: Number(nonce), hash: receipt?.transactionHash } },
                  });
                }
                startSpan(
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
                        contents:
                          assets === undefined
                            ? t("{{symbol}} sent to {{recipient}}", {
                                symbol: symbol.slice(3),
                                recipient: ensName ?? shortenHex(receiver),
                              })
                            : t("{{amount}} {{symbol}} sent to {{recipient}}", {
                                amount: f(formatUnits(assets, decimals)),
                                symbol: symbol.slice(3),
                                recipient: ensName ?? shortenHex(receiver),
                              }),
                        idempotencyKey: v5(
                          `https://exact.ly/proposal/${chain.id}/${proposalManagerAddress}/${account}/${nonce}`,
                          v5.URL,
                        ),
                      }),
                    ),
                ).catch((error: unknown) => captureException(error));
              }
              return redis.zrem("proposals", message);
            },
          ).catch(async (error: unknown) => {
            switch (revertReason(error)) {
              case "NonceTooLow":
              case "NoProposal":
                parent.setStatus({ code: SPAN_STATUS_OK, message: "aborted" });
                return redis.zrem("proposals", message);
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
                for (const p of idleProposals) await scheduleProposal(p);
                parent.setStatus({ code: SPAN_STATUS_OK, message: "rescheduled" });
                return redis.zrem("proposals", message);
              }
              case "Timelocked": {
                const pendingProposals = await publicClient.readContract({
                  address: exaPreviewerAddress,
                  functionName: "pendingProposals",
                  abi: exaPreviewerAbi,
                  args: [account],
                });
                const pending = pendingProposals.find((queued) => queued.nonce === nonce);
                let nextUnlock = pending?.unlock;
                if (!nextUnlock) {
                  const latest = await publicClient.getBlock();
                  nextUnlock = latest.timestamp + 1n;
                }
                await scheduleProposal({ ...proposal, retryCount: retryCount + 1, unlock: nextUnlock });
                parent.setStatus({ code: SPAN_STATUS_OK, message: "retrying" });
                return redis.zrem("proposals", message);
              }
              default:
                parent.setStatus({ code: SPAN_STATUS_ERROR, message: "proposal_failed" });
                if (error instanceof ContractFunctionExecutionError) {
                  const skipped = await skipNonce()
                    .then(() => true)
                    .catch((nonceError: unknown) => {
                      captureException(nonceError, {
                        level: "error",
                        contexts: {
                          proposal: {
                            account,
                            nonce: Number(nonce),
                            proposalType: ProposalType[proposalType],
                            retryCount,
                          },
                        },
                        fingerprint: revertFingerprint(nonceError),
                      });
                      return false;
                    });
                  if (skipped) return redis.zrem("proposals", message);
                } else {
                  captureException(error, {
                    level: "error",
                    contexts: {
                      proposal: { account, nonce: Number(nonce), proposalType: ProposalType[proposalType], retryCount },
                    },
                    fingerprint: revertFingerprint(error),
                  });
                }
            }
          }),
        );
      });

    setTimeout(Math.max(0, (Number(unlock) + 10) * 1000 - Date.now()))
      .then(() => {
        const mutex = mutexes.get(account) ?? createMutex(account);
        return continueTrace({ sentryTrace, baggage: sentryBaggage }, () =>
          withScope((scope) => {
            scope.setUser({ id: account });
            return startSpan(
              {
                name: "acquire mutex",
                op: "lock.acquire",
                attributes: { account, "lock.name": `proposal:${account}` },
              },
              () =>
                mutex.runExclusive(processProposal, -Number(nonce)).finally(() => {
                  if (!mutex.isLocked()) mutexes.delete(account);
                }),
            );
          }),
        );
      })
      .catch((error: unknown) => {
        withScope((scope) => {
          scope.setUser({ id: account });
          captureException(error, { level: "error", fingerprint: revertFingerprint(error) });
        });
      });
  }

  function scheduleWithdraw(message: string) {
    const withdraw = v.parse(Withdraw, deserialize(message));
    const { id, account, market, receiver, amount, unlock, retryCount, sentryTrace, sentryBaggage } = withdraw;
    const bodySize = Buffer.byteLength(message);

    const processWithdraw = () =>
      withScope((scope) => {
        scope.setUser({ id: account });
        return startSpan({ name: "exa.withdraw", op: "exa.withdraw", forceTransaction: true }, (parent) =>
          startSpan(
            {
              name: "process withdraw",
              op: "queue.process",
              attributes: {
                account,
                market,
                receiver,
                amount: String(amount),
                unlock: Number(unlock),
                "messaging.system": "redis",
                "messaging.operation.type": "process",
                "messaging.destination.name": "withdraw",
                "messaging.message.id": id,
                "messaging.message.body.size": bodySize,
                "messaging.message.retry.count": retryCount,
                "messaging.message.receive.latency": Date.now() - Number(unlock) * 1000,
              },
            },
            async () => {
              const receipt = await wallet.exaSend(
                { name: "exa.execute", op: "exa.execute", attributes: { account } },
                {
                  address: account,
                  functionName: "withdraw",
                  abi: [...legacyExaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, marketAbi[6]],
                },
                { ignore: isTerminalWithdrawReason },
              );
              if (receipt?.status !== "success") {
                parent.setStatus({ code: SPAN_STATUS_ERROR, message: "aborted" });
                return redis.zrem("withdraw", message);
              }
              parent.setStatus({ code: SPAN_STATUS_OK });
              startSpan(
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
                      idempotencyKey: v5(
                        `https://exact.ly/withdraw/${chain.id}/${account}/${market}/${receiver}/${amount}/${unlock}`,
                        v5.URL,
                      ),
                    }),
                  ),
              ).catch((error: unknown) => captureException(error));
              return redis.zrem("withdraw", message);
            },
          ).catch((error: unknown) => {
            const reason = revertReason(error, { fallback: "unknown", withArguments: true });
            if (isTerminalWithdrawReason(reason)) {
              parent.setStatus({ code: SPAN_STATUS_ERROR, message: "aborted" });
              return redis.zrem("withdraw", message);
            }
            parent.setStatus({ code: SPAN_STATUS_ERROR, message: "failed_precondition" });
            captureException(error, {
              level: "error",
              contexts: { withdraw: { account, market, receiver, amount: String(amount), retryCount } },
              fingerprint: revertFingerprint(error),
            });
            if (
              chain.id === optimismSepolia.id &&
              error instanceof BaseError &&
              error.cause instanceof CallExecutionError &&
              error.cause.cause instanceof ExecutionRevertedError
            ) {
              return redis.zrem("withdraw", message);
            }
          }),
        );
      });

    setTimeout(Math.max(0, (Number(unlock) + 10) * 1000 - Date.now()))
      .then(() =>
        continueTrace({ sentryTrace, baggage: sentryBaggage }, () =>
          withScope((scope) => {
            scope.setUser({ id: account });
            return processWithdraw();
          }),
        ),
      )
      .catch((error: unknown) => {
        withScope((scope) => {
          scope.setUser({ id: account });
          captureException(error, { level: "error", fingerprint: revertFingerprint(error) });
        });
      });
  }

  return { app, ready };
}

const isTerminalWithdrawReason = (reason: string) =>
  reason === "InsufficientAccountLiquidity()" ||
  reason === "RuntimeValidationFunctionMissing(0x3ccfd60b)" ||
  (reason.startsWith("PreExecHookReverted(") &&
    reason.endsWith(`,${encodeErrorResult({ errorName: "NoProposal", abi: proposalManagerAbi })})`));

function unlessReverted(error: unknown) {
  if (
    !(error instanceof BaseError) ||
    error.walk((cause) => cause instanceof ContractFunctionZeroDataError || cause instanceof ExecutionRevertedError) ===
      null
  ) {
    throw error;
  }
}

const legacyEmitters: Partial<Record<number, { factories: Address[]; plugins: Address[] }>> = {
  [optimism.id]: {
    factories: [
      "0x8D493AF799162Ac3f273e8918B2842447f702163",
      "0x6E1b5A67adD32E8dC034c23b8022b54821ED297b",
      "0x3427a595eD6E05Cc2D8115e28BAd151cB879616e",
      "0xcbeaAF42Cc39c17e84cBeFe85160995B515A9668",
    ].map((address) => v.parse(Address, address)),
    plugins: ["0x87aF7e4892e47a7De34dF689bA5f3bCccED3e5DE", "0x2Bbaf52f13513CE325066D387c1dA1F260c26887"].map(
      (address) => v.parse(Address, address),
    ),
  },
};

async function initializedAccounts(accounts: string[], blockNumber?: number) {
  if (accounts.length === 0) return [];
  const toBlock = blockNumber === undefined ? undefined : BigInt(blockNumber);
  if (toBlock !== undefined && (await publicClient.getBlockNumber({ cacheTime: 0 })) < toBlock) {
    throw new Error("rpc behind block");
  }
  const logs = await publicClient.getLogs({
    address: [...factories.versions],
    event: getAbiItem({ abi: exaAccountFactoryAbi, name: "ExaAccountInitialized" }),
    args: { account: accounts.map((account) => v.parse(Address, account)) },
    toBlock: toBlock ?? "latest",
    fromBlock: 0n,
    strict: true,
  });
  return logs.map(({ args }) => args.account);
}

function discoverEmitters(chainId: number) {
  const legacy = legacyEmitters[chainId] ?? { factories: [], plugins: [] };
  return Promise.all(
    [...factories.versions, ...legacy.factories].map((factory) =>
      publicClient
        .readContract({ address: factory, abi: exaAccountFactoryAbi, functionName: "EXA_PLUGIN" })
        .catch(unlessReverted),
    ),
  )
    .then((plugins) =>
      Promise.all(
        [...new Set([...plugins.filter((plugin) => plugin !== undefined), ...legacy.plugins])].map(async (plugin) => [
          plugin,
          await publicClient
            .readContract({ address: plugin, abi: exaPluginAbi, functionName: "proposalManager" })
            .catch(unlessReverted),
        ]),
      ),
    )
    .then(
      (addresses) =>
        new Set(
          [exaPluginAddress, proposalManagerAddress, ...addresses.flat()]
            .filter((address) => address !== undefined)
            .map((address) => v.parse(Address, address))
            .toSorted(),
        ),
    );
}

const url = `${appOrigin}/hooks/block`;
const withdrawTopic = toEventSelector(getAbiItem({ abi: marketAbi, name: "Withdraw" }));
async function initializeAlchemy(
  alchemy: ReturnType<typeof createAlchemy>,
  signingKeys: Set<string>,
  proposalEmitters: () => Promise<Set<Address>>,
) {
  const currentHook = await alchemy.findWebhook(
    ({ webhook_type, webhook_url }) =>
      webhook_type === "GRAPHQL" && (webhook_url === url || webhook_url.startsWith(`${url}?`)),
  );
  if (currentHook) signingKeys.add(currentHook.signing_key);
  const addresses = [...new Set([...(await proposalEmitters()), marketUSDCAddress])].toSorted();
  const query = `#graphql
{
  block {
    number
    timestamp
    logs(
      filter: {
        addresses: ${JSON.stringify(addresses)}
        topics: [
          [
            "0x4cf7794d9c19185f7d95767c53e511e2e67ae50f68ece9c9079c6ae83403a3e7" # Proposed
            "0x0c652a21d96e4efed065c3ef5961e4be681be99b95dd55126669ae9be95767e0" # Proposed (legacy)
            "${withdrawTopic}" # Withdraw
          ]
        ]
      }
    ) {
      topics
      data
      account {
        address
      }
      transaction {
        hash
      }
    }
  }
}`;
  const webhookUrl = `${url}?query=${createHash("sha256").update(query).digest("hex")}`;
  if (currentHook?.webhook_url === webhookUrl) return;

  const newHook = await alchemy.createWebhook({
    webhook_type: "GRAPHQL",
    webhook_url: webhookUrl,
    graphql_query: { skip_empty_messages: true, query },
  });
  signingKeys.add(newHook.signing_key);
  if (currentHook) {
    const deleteResponse = await fetch(
      `https://dashboard.alchemy.com/api/delete-webhook?webhook_id=${currentHook.id}`,
      { headers: alchemy.headers, method: "DELETE" },
    );
    if (!deleteResponse.ok) throw new ServiceError("Alchemy", deleteResponse.status, await deleteResponse.text());
    await setTimeout(5000);
    signingKeys.delete(currentHook.signing_key);
  }
}

const Proposal = v.pipe(
  v.object({
    account: Address,
    amount: v.bigint(),
    data: Hex,
    market: Address,
    nonce: v.bigint(),
    proposalType: v.enum(ProposalType),
    retryCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
    sentryBaggage: v.optional(v.string()),
    sentryTrace: v.optional(v.string()),
    timestamp: v.optional(v.number()),
    unlock: v.bigint(),
  }),
  v.transform((proposal) => ({
    id: `${proposal.account}:${proposal.market}:${proposal.timestamp ?? Math.floor(Date.now() / 1000)}`,
    ...proposal,
  })),
);

const Withdraw = v.pipe(
  v.object({
    account: Address,
    market: Address,
    receiver: Address,
    amount: v.bigint(),
    unlock: v.bigint(),
    retryCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
    timestamp: v.optional(v.number()),
    sentryTrace: v.optional(v.string()),
    sentryBaggage: v.optional(v.string()),
  }),
  v.transform((withdraw) => ({
    id: `${withdraw.account}:${withdraw.market}:${withdraw.timestamp ?? Math.floor(Date.now() / 1000)}`,
    ...withdraw,
  })),
);

const legacyExaPluginAbi = [
  { type: "function", name: "withdraw", inputs: [], outputs: [], stateMutability: "nonpayable" },
  {
    type: "event",
    name: "Proposed",
    inputs: [
      { name: "account", internalType: "address", type: "address", indexed: true },
      { name: "market", internalType: "contract IMarket", type: "address", indexed: true },
      { name: "receiver", internalType: "address", type: "address", indexed: true },
      { name: "amount", internalType: "uint256", type: "uint256", indexed: false },
      { name: "unlock", internalType: "uint256", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "NoProposal", inputs: [] },
] as const;
