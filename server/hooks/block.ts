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
import createDebug from "debug";
import { Kind, parse, visit, type StringValueNode } from "graphql";
import { Hono } from "hono";
import { Redis } from "ioredis";
import { setTimeout } from "node:timers/promises";
import * as v from "valibot";
import {
  BaseError,
  CallExecutionError,
  decodeEventLog,
  encodeErrorResult,
  ExecutionRevertedError,
  formatUnits,
  type LocalAccount,
} from "viem";
import { optimismSepolia } from "viem/chains";

import chain, {
  auditorAbi,
  exaPluginAbi,
  exaPluginAddress,
  marketAbi,
  proposalManagerAbi,
  proposalManagerAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import revertReason from "@exactly/common/revertReason";
import shortenHex from "@exactly/common/shortenHex";
import { Address, Hash, Hex } from "@exactly/common/validation";

import t, { f } from "../i18n";
import createAlchemy, { headerValidator } from "../utils/alchemy";
import appOrigin from "../utils/appOrigin";
import ensClient from "../utils/ensClient";
import createOnesignal from "../utils/onesignal";
import publicClient from "../utils/publicClient";
import revertFingerprint from "../utils/revertFingerprint";
import validatorHook from "../utils/validatorHook";
import createWallet from "../utils/wallet";
import { Proposal } from "../workers/execute/job";
import createExecute from "../workers/execute/queue";

const debug = createDebug("exa:block");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default function hook({
  alchemyKey,
  blockKey,
  executor,
  onesignalKey,
  redisUrl,
}: {
  alchemyKey: string;
  blockKey?: string;
  executor: LocalAccount;
  onesignalKey: string;
  redisUrl: string;
}) {
  const wallet = createWallet(executor);
  const onesignal = createOnesignal(onesignalKey);
  const redis = new Redis(redisUrl);
  const bullmq = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const execute = createExecute(bullmq);
  if (!blockKey) debug("missing alchemy block key");
  const signingKeys = new Set(blockKey && [blockKey]);
  const ready = Promise.all([
    redis
      .zrange("withdraw", 0, Infinity, "BYSCORE")
      .then((messages) => {
        for (const message of messages) scheduleWithdraw(message);
      })
      .catch((error: unknown) => captureException(error)),
    initializeAlchemy(createAlchemy(alchemyKey), signingKeys).catch((error: unknown) => {
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
                v.object({ topics: v.tupleWithRest([Hash], Hash), data: Hex, account: v.object({ address: Address }) }),
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
      const { timestamp, logs } = c.req.valid("json").event.data.block;

      if (logs.length === 0) {
        setExtra("exa.ignore", true);
        return c.json({}, 200);
      }
      setContext("alchemy", await c.req.json());

      const proposalsBySignature = logs.reduce((accumulator, event) => {
        const signature = event.topics[0];
        if (!accumulator.has(signature)) {
          accumulator.set(signature, []);
        }
        accumulator.get(signature)?.push(event);
        return accumulator;
      }, new Map<string, typeof logs>());

      // TODO use .filter((event) => event.eventName === "Proposed") after migration
      const proposalsByAccount =
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
          }, new Map<string, v.InferOutput<typeof Proposal>[]>()) ?? [];

      const oldWithdraws =
        proposalsBySignature
          .get("0x0c652a21d96e4efed065c3ef5961e4be681be99b95dd55126669ae9be95767e0")
          ?.map(({ topics, data }) => decodeEventLog({ topics, data, abi: legacyExaPluginAbi })) ?? [];

      await Promise.all([
        ...proposalsByAccount.values().map(async (ps) => {
          for (const proposal of ps.toSorted((a, b) => Number(a.nonce - b.nonce))) await execute.enqueue(proposal);
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
      ]);
      return c.json({});
    },
  );

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

    setTimeout(Math.max(0, Number(unlock) * 1000 - Date.now()))
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

  let closing: Promise<unknown> | undefined;
  return {
    app,
    close: () => (closing ??= Promise.all([execute.close().finally(() => bullmq.quit()), redis.quit()])),
    ready,
  };
}

const isTerminalWithdrawReason = (reason: string) =>
  reason === "InsufficientAccountLiquidity()" ||
  reason === "RuntimeValidationFunctionMissing(0x3ccfd60b)" ||
  (reason.startsWith("PreExecHookReverted(") &&
    reason.endsWith(`,${encodeErrorResult({ errorName: "NoProposal", abi: proposalManagerAbi })})`));

const url = `${appOrigin}/hooks/block`;
async function initializeAlchemy(alchemy: ReturnType<typeof createAlchemy>, signingKeys: Set<string>) {
  const currentHook = await alchemy.findWebhook(
    ({ webhook_type, webhook_url }) => webhook_type === "GRAPHQL" && webhook_url === url,
  );
  let shouldUpdate = !currentHook;
  let currentAddresses: string[] = [];
  if (currentHook) {
    signingKeys.add(currentHook.signing_key);

    const queryResponse = await fetch(
      `https://dashboard.alchemy.com/api/dashboard-webhook-graphql-query?webhook_id=${currentHook.id}`,
      { headers: alchemy.headers },
    );
    if (!queryResponse.ok) throw new Error(`${queryResponse.status} ${await queryResponse.text()}`);
    const { data: query } = (await queryResponse.json()) as { data: { graphql_query: string } };
    visit(parse(query.graphql_query), {
      Field(node) {
        if (node.name.value === "block") {
          shouldUpdate ||= !node.selectionSet?.selections.find(
            (selection) => selection.kind === Kind.FIELD && selection.name.value === "number",
          );
        } else if (node.name.value === "logs") {
          const filterArguments = node.arguments?.find(({ name }) => name.value === "filter");
          if (filterArguments?.value.kind === Kind.OBJECT) {
            const addressesField = filterArguments.value.fields.find(({ name }) => name.value === "addresses");
            if (addressesField?.value.kind === Kind.LIST) {
              currentAddresses = addressesField.value.values
                .filter((value): value is StringValueNode => value.kind === Kind.STRING)
                .map(({ value }) => v.parse(Address, value));
              shouldUpdate ||=
                !currentAddresses.includes(exaPluginAddress) || !currentAddresses.includes(proposalManagerAddress);
            }
            const topicsField = filterArguments.value.fields.find(({ name }) => name.value === "topics");
            if (topicsField?.value.kind === Kind.LIST) {
              shouldUpdate ||= topicsField.value.values[0]?.kind !== Kind.LIST;
            }
          }
        }
      },
    });
  }
  if (!shouldUpdate) return;

  const newHook = await alchemy.createWebhook({
    webhook_type: "GRAPHQL",
    webhook_url: url,
    graphql_query: {
      skip_empty_messages: true,
      query: `#graphql
{
  block {
    number
    timestamp
    logs(
      filter: {
        addresses: ${JSON.stringify(
          [...new Set([...currentAddresses, exaPluginAddress, proposalManagerAddress])].toSorted(),
        )}
        topics: [
          [
            "0x4cf7794d9c19185f7d95767c53e511e2e67ae50f68ece9c9079c6ae83403a3e7" # Proposed
            "0x0c652a21d96e4efed065c3ef5961e4be681be99b95dd55126669ae9be95767e0" # Proposed (legacy)
          ]
        ]
      }
    ) {
      topics
      data
      account {
        address
      }
    }
  }
}`,
    },
  });
  signingKeys.add(newHook.signing_key);
  if (currentHook) {
    const deleteResponse = await fetch(
      `https://dashboard.alchemy.com/api/delete-webhook?webhook_id=${currentHook.id}`,
      { headers: alchemy.headers, method: "DELETE" },
    );
    if (!deleteResponse.ok) throw new Error(`${deleteResponse.status} ${await deleteResponse.text()}`);
    await setTimeout(5000);
    signingKeys.delete(currentHook.signing_key);
  }
}

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
