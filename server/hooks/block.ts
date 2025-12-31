import ProposalType from "@exactly/common/ProposalType";
import chain, {
  auditorAbi,
  exaPluginAbi,
  exaPluginAddress,
  exaPreviewerAbi,
  exaPreviewerAddress,
  marketAbi,
  marketWETHAddress,
  proposalManagerAbi,
  proposalManagerAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import { Address, Hash, Hex } from "@exactly/common/validation";
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
} from "@sentry/node";
import { deserialize, serialize } from "@wagmi/core";
import { Mutex } from "async-mutex";
import createDebug from "debug";
import { Kind, parse, visit, type StringValueNode } from "graphql";
import { Hono } from "hono";
import { setTimeout } from "node:timers/promises";
import * as v from "valibot";
import {
  BaseError,
  CallExecutionError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  decodeAbiParameters,
  decodeEventLog,
  encodeErrorResult,
  ExecutionRevertedError,
  formatUnits,
} from "viem";
import { optimismSepolia } from "viem/chains";

import { headers as alchemyHeaders, createWebhook, findWebhook, headerValidator } from "../utils/alchemy";
import appOrigin from "../utils/appOrigin";
import ensClient from "../utils/ensClient";
import keeper from "../utils/keeper";
import { sendPushNotification } from "../utils/onesignal";
import publicClient from "../utils/publicClient";
import redis from "../utils/redis";
import validatorHook from "../utils/validatorHook";

const debug = createDebug("exa:block");
Object.assign(debug, { inspectOpts: { depth: undefined } });

if (!process.env.ALCHEMY_BLOCK_KEY) debug("missing alchemy block key");
const signingKeys = new Set(process.env.ALCHEMY_BLOCK_KEY && [process.env.ALCHEMY_BLOCK_KEY]);

const mutexes = new Map<Address, Mutex>();
function createMutex(address: Address) {
  const mutex = new Mutex();
  mutexes.set(address, mutex);
  return mutex;
}

redis
  .zrange("withdraw", 0, Infinity, "BYSCORE")
  .then((messages) => {
    for (const message of messages) scheduleWithdraw(message);
  })
  .catch((error: unknown) => captureException(error));

redis
  .zrange("proposals", 0, Infinity, "BYSCORE")
  .then((messages) => {
    for (const message of messages) scheduleMessage(message);
  })
  .catch((error: unknown) => captureException(error));

export default new Hono().post(
  "/",
  headerValidator(() => signingKeys),
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
      ...proposalsByAccount
        .values()
        .flatMap((ps) =>
          ps.toSorted((a, b) => Number(a.nonce - b.nonce)).map((proposal) => scheduleProposal(proposal)),
        ),
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
              "messaging.message.id": withdraw.id,
              "messaging.destination.name": "withdraw",
            },
          },
          async () => {
            const { "sentry-trace": sentryTrace, baggage: sentryBaggage } = getTraceData();
            withdraw.sentryTrace = sentryTrace;
            withdraw.sentryBaggage = sentryBaggage;
            const message = serialize(withdraw);
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
        "messaging.destination.name": "proposals",
        "messaging.message.id": proposal.id,
      },
    },
    async () => {
      const { "sentry-trace": sentryTrace, baggage: sentryBaggage } = getTraceData();
      proposal.sentryTrace = sentryTrace;
      proposal.sentryBaggage = sentryBaggage;
      const message = serialize(proposal);
      const added = await redis.zadd("proposals", Number(proposal.unlock + proposal.nonce), message);
      if (added) scheduleMessage(message);
      return added;
    },
  );
}

function scheduleMessage(message: string) {
  const { account, amount, data, id, market, nonce, proposalType, sentryBaggage, sentryTrace, timestamp, unlock } =
    v.parse(Proposal, deserialize(message));
  setTimeout(Math.max(0, (Number(unlock) + 10) * 1000 - Date.now()))
    .then(async () => {
      const mutex = mutexes.get(account) ?? createMutex(account);
      await mutex
        .runExclusive(() =>
          continueTrace({ sentryTrace, baggage: sentryBaggage }, () =>
            startSpan({ name: "exa.execute", op: "exa.execute", forceTransaction: true }, (parent) =>
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
                    "messaging.destination.name": "proposals",
                    "messaging.message.id": id,
                    "messaging.message.receive.latency": Date.now() - Number(unlock) * 1000,
                  },
                },
                async () => {
                  const skipNonce = () =>
                    keeper.exaSend(
                      { name: "exa.nonce", op: "exa.nonce", attributes: { account } },
                      {
                        address: account,
                        functionName: "setProposalNonce",
                        args: [nonce + 1n],
                        abi: [...exaPluginAbi, ...upgradeableModularAccountAbi, ...proposalManagerAbi],
                      },
                    );

                  await (proposalType === ProposalType.None
                    ? skipNonce()
                    : keeper.exaSend(
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
                          ],
                        },
                      ));

                  parent.setStatus({ code: SPAN_STATUS_OK });
                  if (proposalType === ProposalType.Withdraw) {
                    if (market.toLowerCase() === marketWETHAddress.toLowerCase()) await skipNonce();
                    const receiver = v.parse(
                      Address,
                      decodeAbiParameters([{ name: "receiver", type: "address" }], data)[0],
                    );
                    Promise.all([
                      publicClient.readContract({ address: market, abi: marketAbi, functionName: "decimals" }),
                      publicClient.readContract({ address: market, abi: marketAbi, functionName: "symbol" }),
                      ensClient.getEnsName({ address: receiver }).catch(() => null),
                    ])
                      .then(([decimals, symbol, ensName]) =>
                        sendPushNotification({
                          userId: account,
                          headings: { en: "Withdraw completed" },
                          contents: {
                            en: `${formatUnits(amount, decimals)} ${symbol.slice(3)} sent to ${ensName ?? shortenHex(receiver)}`,
                          },
                        }),
                      )
                      .catch((error: unknown) => captureException(error));
                  }
                  return redis.zrem("proposals", message);
                },
              ).catch(async (error: unknown) => {
                parent.setStatus({ code: SPAN_STATUS_ERROR, message: "proposal_failed" });
                captureException(error, {
                  level: "error",
                  contexts: { proposal: { account, nonce, proposalType: ProposalType[proposalType] } },
                });

                if (
                  error instanceof BaseError &&
                  error.cause instanceof ContractFunctionRevertedError &&
                  error.cause.data?.errorName === "NotNext"
                ) {
                  const pendingProposals = await publicClient.readContract({
                    address: exaPreviewerAddress,
                    functionName: "pendingProposals",
                    abi: exaPreviewerAbi,
                    args: [account],
                  });
                  const idleProposals = pendingProposals
                    .filter((idle) => Number(idle.nonce) <= nonce)
                    .map((idle) =>
                      v.parse(Proposal, {
                        ...idle.proposal,
                        timestamp: Number(idle.proposal.timestamp),
                        nonce: idle.nonce,
                        account,
                        unlock: idle.unlock,
                      }),
                    );
                  setContext("exa", { idleProposals });
                  await Promise.all(idleProposals.map((proposal) => scheduleProposal(proposal)));
                  return redis.zrem("proposals", message);
                }

                if (error instanceof ContractFunctionExecutionError) {
                  await keeper.exaSend(
                    { name: "exa.nonce", op: "exa.nonce", attributes: { account } },
                    {
                      address: account,
                      functionName: "setProposalNonce",
                      args: [nonce + 1n],
                      abi: [...exaPluginAbi, ...upgradeableModularAccountAbi, ...proposalManagerAbi],
                    },
                  );
                  return redis.zrem("proposals", message);
                }
              }),
            ),
          ),
        )
        .finally(() => {
          if (!mutex.isLocked()) mutexes.delete(account);
        });
    })
    .catch((error: unknown) => captureException(error));
}

function scheduleWithdraw(message: string) {
  const { id, account, market, receiver, amount, unlock, sentryTrace, sentryBaggage } = v.parse(
    Withdraw,
    deserialize(message),
  );
  setTimeout(Math.max(0, (Number(unlock) + 10) * 1000 - Date.now()))
    .then(() =>
      continueTrace({ sentryTrace, baggage: sentryBaggage }, () =>
        startSpan({ name: "exa.withdraw", op: "exa.withdraw", forceTransaction: true }, (parent) =>
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
                "messaging.message.id": id,
                "messaging.destination.name": "withdraw",
                "messaging.message.receive.latency": Date.now() - Number(unlock) * 1000,
              },
            },
            async () => {
              await keeper.exaSend(
                { name: "exa.execute", op: "exa.execute", attributes: { account } },
                {
                  address: account,
                  functionName: "withdraw",
                  abi: [...legacyExaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, marketAbi[6]],
                },
              );
              parent.setStatus({ code: SPAN_STATUS_OK });
              Promise.all([
                publicClient.readContract({ address: market, abi: marketAbi, functionName: "decimals" }),
                publicClient.readContract({ address: market, abi: marketAbi, functionName: "symbol" }),
                ensClient.getEnsName({ address: receiver }),
              ])
                .then(([decimals, symbol, ensName]) =>
                  sendPushNotification({
                    userId: account,
                    headings: { en: "Withdraw completed" },
                    contents: {
                      en: `${formatUnits(amount, decimals)} ${symbol.slice(3)} sent to ${ensName ?? shortenHex(receiver)}`,
                    },
                  }),
                )
                .catch((error: unknown) => captureException(error));
              return redis.zrem("withdraw", message);
            },
          ).catch((error: unknown) => {
            if (
              error instanceof BaseError &&
              error.cause instanceof ContractFunctionRevertedError &&
              error.cause.data?.errorName === "PreExecHookReverted" &&
              error.cause.data.args?.[2] === encodeErrorResult({ errorName: "NoProposal", abi: legacyExaPluginAbi })
            ) {
              parent.setStatus({ code: SPAN_STATUS_ERROR, message: "aborted" });
              return redis.zrem("withdraw", message);
            }
            parent.setStatus({ code: SPAN_STATUS_ERROR, message: "failed_precondition" });
            captureException(error);
            if (
              chain.id === optimismSepolia.id &&
              error instanceof BaseError &&
              error.cause instanceof CallExecutionError &&
              error.cause.cause instanceof ExecutionRevertedError
            ) {
              return redis.zrem("withdraw", message);
            }
          }),
        ),
      ),
    )
    .catch((error: unknown) => captureException(error));
}

const url = `${appOrigin}/hooks/block`;
findWebhook(({ webhook_type, webhook_url }) => webhook_type === "GRAPHQL" && webhook_url === url)
  .then(async (currentHook) => {
    let shouldUpdate = !currentHook;
    let currentAddresses: string[] = [];
    if (currentHook) {
      signingKeys.add(currentHook.signing_key);

      const queryResponse = await fetch(
        `https://dashboard.alchemy.com/api/dashboard-webhook-graphql-query?webhook_id=${currentHook.id}`,
        { headers: alchemyHeaders },
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

    const newHook = await createWebhook({
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
        { headers: alchemyHeaders, method: "DELETE" },
      );
      if (!deleteResponse.ok) throw new Error(`${deleteResponse.status} ${await deleteResponse.text()}`);
      await setTimeout(5000);
      signingKeys.delete(currentHook.signing_key);
    }
  })
  .catch((error: unknown) => captureException(error));

const Proposal = v.pipe(
  v.object({
    account: Address,
    amount: v.bigint(),
    data: Hex,
    market: Address,
    nonce: v.bigint(),
    proposalType: v.enum(ProposalType),
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
