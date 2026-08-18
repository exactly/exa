import { vValidator } from "@hono/valibot-validator";
import { captureException, getActiveSpan, SEMANTIC_ATTRIBUTE_SENTRY_OP, setContext, setExtra } from "@sentry/node";
import createDebug from "debug";
import { Kind, parse, visit, type StringValueNode } from "graphql";
import { Hono } from "hono";
import { Redis } from "ioredis";
import { setTimeout } from "node:timers/promises";
import * as v from "valibot";
import { decodeEventLog } from "viem";

import {
  exaPluginAbi,
  exaPluginAddress,
  proposalManagerAbi,
  proposalManagerAddress,
} from "@exactly/common/generated/chain";
import { Address, Hash, Hex } from "@exactly/common/validation";

import createAlchemy, { headerValidator } from "../utils/alchemy";
import appOrigin from "../utils/appOrigin";
import validatorHook from "../utils/validatorHook";
import { Proposal, type Proposal as ProposalOutput } from "../workers/execute/job";
import createExecute from "../workers/execute/queue";

const debug = createDebug("exa:block");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default function hook({
  alchemyKey,
  blockKey,
  redisUrl,
}: {
  alchemyKey: string;
  blockKey?: string;
  redisUrl: string;
}) {
  const bullmq = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const execute = createExecute(bullmq);
  if (!blockKey) debug("missing alchemy block key");
  const signingKeys = new Set(blockKey && [blockKey]);
  const ready = initializeAlchemy(createAlchemy(alchemyKey), signingKeys).catch((error: unknown) => {
    if (signingKeys.size === 0) throw error;
    captureException(error, { level: "warning" });
  });
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

      const proposals = [
        ...(proposalsBySignature
          .get("0x4cf7794d9c19185f7d95767c53e511e2e67ae50f68ece9c9079c6ae83403a3e7")
          ?.map(({ topics, data }) => decodeEventLog({ topics, data, abi: [...exaPluginAbi, ...proposalManagerAbi] }))
          .map(({ args }) => ({ ...args, functionName: "executeProposal" as const, timestamp })) ?? []),
        ...(proposalsBySignature
          .get("0x0c652a21d96e4efed065c3ef5961e4be681be99b95dd55126669ae9be95767e0")
          ?.map(({ topics, data }) => decodeEventLog({ topics, data, abi: legacyAbi }))
          .map(({ args }) => ({ ...args, functionName: "withdraw" as const, timestamp })) ?? []),
      ]
        .map((proposal) => {
          const parsed = v.safeParse(Proposal, proposal);
          if (parsed.success) return parsed.output;
          captureException(parsed.issues, { level: "error" });
          return null;
        })
        .filter((proposal) => proposal !== null)
        .reduce((grouped, proposal) => {
          if (!grouped.has(proposal.account)) grouped.set(proposal.account, []);
          grouped.get(proposal.account)?.push(proposal);
          return grouped;
        }, new Map<string, ProposalOutput[]>());

      await Promise.all(
        [...proposals.values()].map(async (group) => {
          for (const proposal of group.toSorted((a, b) => {
            if (a.functionName === "executeProposal" && b.functionName === "executeProposal")
              return Number(a.nonce - b.nonce);
            if (a.functionName === "executeProposal") return -1;
            if (b.functionName === "executeProposal") return 1;
            return 0;
          }))
            await execute.enqueue(proposal);
        }),
      );
      return c.json({});
    },
  );

  let closing: Promise<unknown> | undefined;
  return {
    app,
    close: () => (closing ??= execute.close().finally(() => bullmq.quit())),
    ready,
  };
}

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

const legacyAbi = [
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
] as const;
