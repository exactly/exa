import ProposalType from "@exactly/common/ProposalType";
import chain, {
  exaPluginAbi,
  exaPluginAddress,
  exaPreviewerAbi,
  exaPreviewerAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import { Address, Hash, Hex } from "@exactly/common/validation";
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
import { optimism, optimismSepolia } from "viem/chains";

import { auditorAbi, marketAbi, proposalManagerAbi, proposalManagerAddress } from "../generated/contracts";
import { headerValidator, jsonValidator, webhooksKey } from "../utils/alchemy";
import appOrigin from "../utils/appOrigin";
import ensClient from "../utils/ensClient";
import keeper from "../utils/keeper";
import { sendPushNotification } from "../utils/onesignal";
import publicClient from "../utils/publicClient";
import redis from "../utils/redis";

if (!process.env.ALCHEMY_BLOCK_KEY) throw new Error("missing alchemy block key");
const signingKeys = new Set([process.env.ALCHEMY_BLOCK_KEY]);

const debug = createDebug("exa:block");
Object.assign(debug, { inspectOpts: { depth: undefined } });

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
  jsonValidator(
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
    debug,
    ({ event }) => event.data.block.logs.length > 0,
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
        .flatMap((ps) => ps.sort((a, b) => Number(a.nonce - b.nonce)).map((proposal) => scheduleProposal(proposal))),
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
          () => {
            const { "sentry-trace": sentryTrace, baggage: sentryBaggage } = getTraceData();
            withdraw.sentryTrace = sentryTrace;
            withdraw.sentryBaggage = sentryBaggage;
            const message = serialize(withdraw);
            scheduleWithdraw(message);
            return redis.zadd("withdraw", Number(event.args.unlock), message);
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
    () => {
      const { "sentry-trace": sentryTrace, baggage: sentryBaggage } = getTraceData();
      proposal.sentryTrace = sentryTrace;
      proposal.sentryBaggage = sentryBaggage;
      const message = serialize(proposal);
      scheduleMessage(message);
      return redis.zadd("proposals", Number(proposal.unlock + proposal.nonce), message);
    },
  );
}

function scheduleMessage(message: string) {
  const { account, amount, data, id, market, nonce, proposalType, sentryBaggage, sentryTrace, timestamp, unlock } =
    v.parse(Proposal, deserialize(message));
  setTimeout((Number(unlock) + 10) * 1000 - Date.now())
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
                  await keeper.exaSend(
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
                  );

                  parent.setStatus({ code: SPAN_STATUS_OK, message: "ok" });
                  if (proposalType === ProposalType.Withdraw) {
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
                            en: `${formatUnits(BigInt(amount), decimals)} ${symbol.slice(3)} sent to ${ensName ?? shortenHex(receiver)}`,
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
  setTimeout((Number(unlock) + 10) * 1000 - Date.now())
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
              parent.setStatus({ code: SPAN_STATUS_OK, message: "ok" });
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

const alchemyInit = { headers: { "Content-Type": "application/json", "X-Alchemy-Token": webhooksKey } };
fetch("https://dashboard.alchemy.com/api/team-webhooks", alchemyInit)
  .then(async (webhooksResponse) => {
    if (!webhooksResponse.ok) throw new Error(`${webhooksResponse.status} ${await webhooksResponse.text()}`);

    const url = `${appOrigin}/hooks/block`;
    const network = { [optimism.id]: "OPT_MAINNET", [optimismSepolia.id]: "OPT_SEPOLIA" }[chain.id];

    const { data: webhooks } = (await webhooksResponse.json()) as {
      data: [
        {
          id: string;
          network: string;
          webhook_type: string;
          webhook_url: string;
          signing_key: string;
          is_active: boolean;
        },
      ];
    };
    const currentHook = webhooks.find(
      (hook) =>
        hook.is_active && hook.webhook_type === "GRAPHQL" && hook.network === network && hook.webhook_url === url,
    );
    if (!currentHook) throw new Error("missing webhook");
    signingKeys.add(currentHook.signing_key);

    const queryResponse = await fetch(
      `https://dashboard.alchemy.com/api/dashboard-webhook-graphql-query?webhook_id=${currentHook.id}`,
      alchemyInit,
    );
    if (!queryResponse.ok) throw new Error(`${queryResponse.status} ${await queryResponse.text()}`);
    const { data: query } = (await queryResponse.json()) as { data: { graphql_query: string } };
    let shouldUpdate = false;
    let currentAddresses: string[] = [];
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
            if (topicsField?.value.kind === Kind.LIST) shouldUpdate ||= topicsField.value.values[0]?.kind !== Kind.LIST;
          }
        }
      },
    });
    if (!shouldUpdate) return; // eslint-disable-line @typescript-eslint/no-unnecessary-condition

    const createResponse = await fetch("https://dashboard.alchemy.com/api/create-webhook", {
      ...alchemyInit,
      method: "POST",
      body: JSON.stringify({
        network,
        webhook_type: "GRAPHQL",
        webhook_url: url,
        graphql_query: `#graphql
{
  block {
    number
    timestamp
    logs(
      filter: {
        addresses: ${JSON.stringify(
          [...new Set([...currentAddresses, exaPluginAddress, proposalManagerAddress])].sort(),
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
      }),
    });
    if (!createResponse.ok) throw new Error(`${createResponse.status} ${await createResponse.text()}`);
    const { data: newHook } = (await createResponse.json()) as { data: { signing_key: string } };
    signingKeys.add(newHook.signing_key);
    const deleteResponse = await fetch(
      `https://dashboard.alchemy.com/api/delete-webhook?webhook_id=${currentHook.id}`,
      { ...alchemyInit, method: "DELETE" },
    );
    if (!deleteResponse.ok) throw new Error(`${deleteResponse.status} ${await deleteResponse.text()}`);
    await setTimeout(5000);
    signingKeys.delete(currentHook.signing_key);
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
