import { vValidator } from "@hono/valibot-validator";
import { captureException, getActiveSpan, SEMANTIC_ATTRIBUTE_SENTRY_OP, setContext, setExtra } from "@sentry/node";
import { deserialize } from "@wagmi/core";
import createDebug from "debug";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import * as v from "valibot";
import {
  BaseError,
  ContractFunctionZeroDataError,
  decodeEventLog,
  ExecutionRevertedError,
  getAbiItem,
  isAddressEqual,
  parseEventLogs,
  toEventSelector,
} from "viem";
import { entryPoint06Abi, entryPoint06Address } from "viem/account-abstraction";
import { optimism } from "viem/chains";

import chain, {
  exaAccountFactoryAbi,
  exaPluginAbi,
  exaPluginAddress,
  marketAbi,
  marketUSDCAddress,
  proposalManagerAbi,
  proposalManagerAddress,
} from "@exactly/common/generated/chain";
import { Address, Hash, Hex } from "@exactly/common/validation";

import { credentials } from "../database/schema";
import { headerValidator } from "../utils/alchemy";
import appOrigin from "../utils/appOrigin";
import publicClient from "../utils/publicClient";
import pay from "../utils/ramps/pay";
import ServiceError from "../utils/ServiceError";
import validatorHook from "../utils/validatorHook";
import validFactories from "../utils/validFactories";
import { legacyExaPluginAbi, Proposal, Withdraw } from "../workers/proposal/job";

import type * as schema from "../database/schema";
import type createAlchemy from "../utils/alchemy";
import type createPersona from "../utils/persona";
import type createManteca from "../utils/ramps/manteca";
import type createProposal from "../workers/proposal/queue";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";

const debug = createDebug("exa:block");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default function hook({
  alchemy,
  blockKey,
  chainId = chain.id,
  database,
  manteca,
  persona,
  proposal,
  redis,
}: {
  alchemy: ReturnType<typeof createAlchemy>;
  blockKey?: string;
  chainId?: number;
  database: NodePgDatabase<typeof schema>;
  manteca: ReturnType<typeof createManteca>;
  persona: ReturnType<typeof createPersona>;
  proposal: ReturnType<typeof createProposal>;
  redis: Redis;
}) {
  const initialized = new Set<string>();
  const foreign = new Map<string, number>();
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
    migrate("withdraw", Withdraw), // TODO remove after migration
    migrate("proposals", Proposal), // TODO remove after migration
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
      const now = Date.now();
      for (const [account, expiry] of foreign) if (expiry <= now) foreign.delete(account);
      const uncached = accounts.filter(
        (account) => !credentialed.has(account) && !initialized.has(account) && !foreign.has(account),
      );
      const lookups = await initializedAccounts(uncached, number);
      for (const lookup of lookups) {
        if (lookup.status === "rejected") continue;
        for (const account of lookup.value.batch) {
          if (lookup.value.found.has(account)) initialized.add(account);
          else foreign.set(account, now + FOREIGN_TTL);
        }
      }
      const failed = lookups.find((lookup) => lookup.status === "rejected");
      if (failed) throw failed.reason;
      const known = new Set(accounts.filter((account) => credentialed.has(account) || initialized.has(account)));
      const unknown = accounts.filter((account) => !known.has(account));
      if (unknown.length > 0) getActiveSpan()?.setAttribute("exa.unknown", unknown);
      const proposalsByAccount = new Map(proposed.entries().filter(([account]) => known.has(account)));
      const oldWithdraws = withdraws.filter(({ args }) => known.has(args.account));

      const failures: unknown[] = [];
      await Promise.all([
        ...proposalsByAccount.values().map(async (ps) => {
          for (const p of ps.toSorted((a, b) => Number(a.nonce - b.nonce))) await proposal.enqueue(p);
        }),
        ...oldWithdraws.map((event) => proposal.enqueue(v.parse(Withdraw, { ...event.args, timestamp }))),
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

  async function migrate(key: string, schema: typeof Proposal | typeof Withdraw) {
    for (const message of await redis.zrange(key, 0, Infinity, "BYSCORE")) {
      const parsed = v.safeParse(schema, deserialize(message));
      if (!parsed.success) {
        captureException(parsed.issues, { level: "error", contexts: { migrate: { key } } });
        continue;
      }
      await proposal.enqueue(parsed.output);
      await redis.zrem(key, message);
    }
  }

  return { app, ready };
}

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

const LOOKUP_BATCH = 100;
const FOREIGN_TTL = 5 * 60_000;

async function initializedAccounts(accounts: string[], blockNumber?: number) {
  if (accounts.length === 0) return [];
  const toBlock = blockNumber === undefined ? undefined : BigInt(blockNumber);
  if (toBlock !== undefined && (await publicClient.getBlockNumber({ cacheTime: 0 })) < toBlock) {
    throw new Error("rpc behind block");
  }
  const batches = Array.from({ length: Math.ceil(accounts.length / LOOKUP_BATCH) }, (_, index) =>
    accounts.slice(index * LOOKUP_BATCH, (index + 1) * LOOKUP_BATCH),
  );
  return Promise.allSettled(
    batches.map(async (batch) => {
      const logs = await publicClient.getLogs({
        address: [...validFactories],
        event: getAbiItem({ abi: exaAccountFactoryAbi, name: "ExaAccountInitialized" }),
        args: { account: batch.map((account) => v.parse(Address, account)) },
        toBlock: toBlock ?? "latest",
        fromBlock: 0n,
        strict: true,
      });
      return { batch, found: new Set<string>(logs.map(({ args }) => args.account)) };
    }),
  );
}

function discoverEmitters(chainId: number) {
  const legacy = legacyEmitters[chainId] ?? { factories: [], plugins: [] };
  return Promise.all(
    [...validFactories, ...legacy.factories].map((factory) =>
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
