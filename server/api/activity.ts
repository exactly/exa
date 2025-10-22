import { decodeWithdraw } from "@exactly/common/ProposalType";
import fixedRate from "@exactly/common/fixedRate";
import chain, {
  exaPreviewerAddress,
  marketUSDCAddress,
  marketWETHAddress,
  proposalManagerAddress,
} from "@exactly/common/generated/chain";
import { Address, Hash, type Hex } from "@exactly/common/validation";
import { effectiveRate, WAD } from "@exactly/lib";
import { renderToBuffer } from "@react-pdf/renderer";
import { captureException, setUser } from "@sentry/node";
import { and, arrayOverlaps, eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as vValidator } from "hono-openapi/valibot";
import {
  array,
  bigint,
  boolean,
  type InferInput,
  type InferOutput,
  intersect,
  isoTimestamp,
  length,
  literal,
  looseObject,
  minLength,
  nullable,
  nullish,
  number,
  object,
  optional,
  parse,
  picklist,
  pipe,
  safeParse,
  string,
  transform,
  undefined_,
  union,
  variant,
} from "valibot";
import { decodeFunctionData, zeroHash, type Log } from "viem";

import database, { credentials, cards, transactions as transactionsSchema } from "../database";
import {
  exaPluginAbi,
  exaPreviewerAbi,
  marketAbi,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
} from "../generated/contracts";
import auth from "../middleware/auth";
import Statement from "../utils/Statement";
import { collectors as cryptomateCollectors } from "../utils/cryptomate";
import { collectors as pandaCollectors } from "../utils/panda";
import publicClient from "../utils/publicClient";
import validatorHook from "../utils/validatorHook";

const ActivityTypes = picklist(["card", "received", "repay", "sent"]);

const collectors = new Set([...cryptomateCollectors, ...pandaCollectors].map((a) => a.toLowerCase() as Hex));

export default new Hono().get(
  "/",
  auth(),
  vValidator(
    "query",
    optional(
      object({ include: optional(union([ActivityTypes, array(ActivityTypes)])), maturity: optional(string()) }),
      {},
    ),
    validatorHook(),
  ),
  async (c) => {
    const { include, maturity } = c.req.valid("query");
    function ignore(type: InferInput<typeof ActivityTypes>) {
      return include && (Array.isArray(include) ? !include.includes(type) : include !== type);
    }

    const { credentialId } = c.req.valid("cookie");
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true },
      with: {
        cards: {
          columns: {},
          with: { transactions: { columns: { hashes: true, payload: true } } },
          limit: ignore("card") || maturity ? 0 : undefined,
        },
      },
    });
    if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
    const account = parse(Address, credential.account);
    setUser({ id: account });

    const [markets, plugins] = await Promise.all([
      publicClient
        .readContract({ address: exaPreviewerAddress, functionName: "markets", abi: exaPreviewerAbi })
        .then((p) => new Map<Hex, (typeof p)[number]>(p.map((m) => [m.market.toLowerCase() as Hex, m]))),
      !ignore("repay") || !ignore("sent") || !ignore("received")
        ? publicClient
            .getContractEvents({
              abi: upgradeableModularAccountAbi,
              eventName: "PluginInstalled",
              address: account,
              toBlock: "latest",
              fromBlock: 0n,
              strict: true,
            })
            .then((logs) => new Set(logs.map(({ args }) => args.plugin.toLowerCase() as Hex)))
        : Promise.resolve(forbid(new Set<Hex>())),
    ]);

    const market = (address: Hex) => {
      const found = markets.get(address.toLowerCase() as Hex);
      if (!found) throw new Error("market not found");
      return found;
    };

    const repayPromise =
      !ignore("repay") || !ignore("received")
        ? publicClient.getContractEvents({
            abi: marketAbi,
            eventName: "RepayAtMaturity",
            address: [...markets.keys()],
            args: { caller: [...plugins], borrower: account, ...(maturity && { maturity: BigInt(maturity) }) },
            toBlock: "latest",
            fromBlock: 0n,
            strict: true,
          })
        : Promise.resolve(forbid([]));

    const [deposits, repays, withdraws, borrows] = await Promise.all([
      ignore("received")
        ? []
        : Promise.all([
            publicClient
              .getContractEvents({
                abi: marketAbi,
                eventName: "Deposit",
                address: [...markets.keys()],
                args: { caller: account, owner: account },
                toBlock: "latest",
                fromBlock: 0n,
                strict: true,
              })
              .then((logs) =>
                logs.map((log) =>
                  parse(DepositActivity, { ...log, market: market(log.address) } satisfies InferInput<
                    typeof DepositActivity
                  >),
                ),
              ),
            repayPromise,
          ]).then(([deposit, repay]) =>
            deposit.filter(
              ({ transactionHash }) => !repay.some(({ transactionHash: repayHash }) => repayHash === transactionHash),
            ),
          ),
      ignore("repay")
        ? []
        : repayPromise.then((logs) =>
            logs.map((log) =>
              parse(RepayActivity, { ...log, market: market(log.address) } satisfies InferInput<typeof RepayActivity>),
            ),
          ),
      ignore("sent")
        ? []
        : Promise.all([
            publicClient.getContractEvents({
              abi: marketAbi,
              eventName: "Withdraw",
              address: [...markets.keys()],
              args: { caller: account, owner: account },
              toBlock: "latest",
              fromBlock: 0n,
              strict: true,
            }),
            publicClient.getContractEvents({
              abi: proposalManagerAbi,
              eventName: "Proposed",
              address: proposalManagerAddress,
              args: { account, market: marketWETHAddress },
              toBlock: "latest",
              fromBlock: 0n,
              strict: true,
            }),
          ]).then(([withdraw, proposed]) =>
            Promise.all(
              withdraw.map(async (log) => {
                const receiver = log.args.receiver.toLowerCase() as Hex;
                if (!collectors.has(receiver) && !plugins.has(receiver) && receiver !== account.toLowerCase()) {
                  return log;
                }
                if (log.address.toLowerCase() === marketWETHAddress.toLowerCase() && plugins.has(receiver)) {
                  const { input: data } = await publicClient.getTransaction({ hash: log.transactionHash });
                  if (data === "0x3ccfd60b") return log;
                  const { functionName, args } = decodeFunctionData({ data, abi: exaPluginAbi });
                  if (functionName !== "executeProposal") return;
                  const proposal = proposed.find(({ args: { nonce } }) => nonce === args[0]);
                  if (!proposal) return;
                  return {
                    ...log,
                    args: {
                      caller: account,
                      receiver: decodeWithdraw(proposal.args.data),
                      owner: account,
                      assets: proposal.args.amount,
                      shares: -1n,
                    },
                  } satisfies Log<bigint, number, false, undefined, true, typeof marketAbi, "Withdraw">;
                }
              }),
            ).then((logs) =>
              logs
                .filter((log) => !!log)
                .map((log) =>
                  parse(WithdrawActivity, { ...log, market: market(log.address) } satisfies InferInput<
                    typeof WithdrawActivity
                  >),
                ),
            ),
          ),
      ignore("card")
        ? undefined
        : publicClient
            .getContractEvents({
              abi: marketAbi,
              eventName: "BorrowAtMaturity",
              address: marketUSDCAddress,
              args: { borrower: account },
              toBlock: "latest",
              fromBlock: 0n,
              strict: true,
            })
            .then((logs) =>
              logs.reduce((map, { args, transactionHash, blockNumber }) => {
                const data = map.get(transactionHash);
                if (!data) return map.set(transactionHash, { blockNumber, events: [args] });
                data.events.push(args);
                return map;
              }, new Map<Hash, { blockNumber: bigint; events: (typeof logs)[number]["args"][] }>()),
            ),
    ]);
    const blocks = await Promise.all(
      [
        ...new Set(
          [...deposits, ...repays, ...withdraws, ...(borrows?.values() ?? [])].map(({ blockNumber }) => blockNumber),
        ),
      ].map((blockNumber) => publicClient.getBlock({ blockNumber })),
    );
    const timestamps = new Map(blocks.map(({ number: block, timestamp }) => [block, timestamp]));
    const cardPurchases =
      !ignore("card") && maturity
        ? await (async function () {
            const hashes = borrows
              ? borrows
                  .entries()
                  .filter(([_, { events }]) => events.some(({ maturity: m }) => m === BigInt(maturity)))
                  .map(([hash]) => hash)
              : [];

            const transactions = await database.query.transactions.findMany({
              where: arrayOverlaps(transactionsSchema.hashes, [...hashes]),
              columns: { hashes: true, payload: true },
            });
            return [{ transactions }];
          })()
        : credential.cards;

    const response = [
      ...cardPurchases.flatMap(({ transactions }) =>
        transactions.map(({ hashes, payload }) => {
          const panda = safeParse(PandaActivity, {
            ...(payload as object),
            hashes,
            borrows: hashes.map((h) => {
              const b = borrows?.get(h as Hash);
              if (!b) return null;
              return {
                events: b.events,
                timestamps: b.blockNumber && timestamps.get(b.blockNumber),
              };
            }),
          });
          if (panda.success) return panda.output;

          if (hashes.length !== 1) throw new Error("cryptomate transactions need to have only one hash");
          const hash = hashes[0];
          const borrow = borrows?.get(hash as Hash);
          const cryptomate = safeParse(
            { 0: DebitActivity, 1: CreditActivity }[borrow?.events.length ?? 0] ?? InstallmentsActivity,
            {
              ...(payload as object),
              hash,
              events: borrow?.events,
              blockTimestamp: borrow?.blockNumber && timestamps.get(borrow.blockNumber),
            },
          );
          if (cryptomate.success) return cryptomate.output;
          captureException(new Error("bad transaction"), { level: "error", contexts: { cryptomate, panda } });
        }),
      ),
      ...[...deposits, ...repays, ...withdraws].map(({ blockNumber, ...event }) => {
        const timestamp = timestamps.get(blockNumber);
        if (timestamp) return { ...event, timestamp: new Date(Number(timestamp) * 1000).toISOString() };
        captureException(new Error("block not found"), {
          level: "error",
          contexts: { event: { ...event, timestamp } },
        });
      }),
    ]
      .filter(<T>(value: T | undefined): value is T => value !== undefined)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));

    if (maturity && c.req.header("accept") === "application/pdf") {
      const card = await database.query.cards.findFirst({
        columns: { lastFour: true },
        where: and(eq(cards.credentialId, credentialId), eq(cards.status, "ACTIVE")),
      });
      const statement = {
        maturity: Number(maturity),
        lastFour: card?.lastFour ?? "",
        data: response
          .map((item) => {
            if (item.type === "panda") {
              return {
                timestamp: item.timestamp,
                description: `${item.merchant.name}${item.merchant.city ? `,${item.merchant.city}` : ""}`,
                installments: item.operations
                  .reduce((accumulator, operation) => {
                    if ("borrow" in operation) {
                      if ("installments" in operation.borrow) {
                        const installments = operation.borrow.installments;
                        const n = installments.findIndex((installment) => installment.maturity === Number(maturity));
                        const progress = `${n + 1}/${installments.length}`;
                        const status = accumulator.get(progress) ?? {
                          current: n + 1,
                          total: installments.length,
                          amount: 0,
                        };
                        status.amount += (installments[n]?.assets ?? 0) + (installments[n]?.fee ?? 0);
                        accumulator.set(progress, status);
                      } else {
                        const status = accumulator.get("1/1") ?? {
                          current: 1,
                          total: 1,
                          amount: 0,
                        };
                        status.amount += operation.borrow.assets + operation.borrow.fee;
                        accumulator.set("1/1", status);
                      }
                    }
                    return accumulator;
                  }, new Map<string, { current: number; total: number; amount: number }>())
                  .values()
                  .toArray(),
              };
            }
            if (item.type === "repay") {
              return {
                timestamp: item.timestamp,
                positionAmount: item.positionAmount,
                amount: item.amount,
                discount: ((item.positionAmount - item.amount) / item.positionAmount) * 100,
              };
            }
          })
          .filter((item) => item !== undefined),
      };
      const pdf = await renderToBuffer(Statement(statement));
      return c.body(toArrayBuffer(pdf.buffer), 200, { "content-type": "application/pdf" });
    }
    return c.json(response, 200);
  },
);

const Borrow = object({ maturity: bigint(), assets: bigint(), fee: bigint() });

export const PandaActivity = pipe(
  object({
    bodies: array(looseObject({ action: picklist(["created", "completed", "updated"]) })),
    borrows: array(nullable(object({ timestamp: optional(bigint()), events: array(Borrow) }))),
    hashes: array(Hash),
    type: literal("panda"),
  }),
  transform(({ bodies, borrows, hashes, type }) => {
    const operations = hashes.map((hash, index) => {
      const borrow = borrows[index];
      const validation = safeParse(
        { 0: DebitActivity, 1: CreditActivity }[borrow?.events.length ?? 0] ?? InstallmentsActivity,
        {
          ...bodies[index],
          forceCapture: bodies[index]?.action === "completed" && !bodies.some((b) => b.action === "created"),
          type,
          hash,
          events: borrow?.events,
          blockTimestamp: borrow?.timestamp,
        },
      );
      if (validation.success) return validation.output;
      throw new Error("bad panda activity");
    });

    const flow = operations.reduce<{
      created: (typeof operations)[number] | undefined;
      updates: (typeof operations)[number][];
      completed: (typeof operations)[number] | undefined;
    }>(
      (f, operation) => {
        if (operation.action === "updated") f.updates.push(operation);
        else if (operation.action === "created" || operation.action === "completed") f[operation.action] = operation;
        else throw new Error("bad action");
        return f;
      },
      { created: undefined, updates: [], completed: undefined },
    );

    const details = flow.created ?? flow.completed;
    if (!details) throw new Error("invalid flow");

    const {
      id,
      currency,
      timestamp,
      merchant: { city, country, name, state },
    } = details;
    const usdAmount = operations.reduce((sum, { usdAmount: amount }) => sum + amount, 0);
    const exchangeRate = flow.completed?.exchangeRate ?? [flow.created, ...flow.updates].at(-1)?.exchangeRate;
    if (!exchangeRate) throw new Error("no exchange rate");
    return {
      id,
      currency,
      amount: usdAmount * exchangeRate,
      merchant: {
        name: name.trim(),
        city: city?.trim(),
        country: country?.trim(),
        state: state?.trim(),
        icon: flow.completed?.merchant.icon ?? flow.updates.at(-1)?.merchant.icon,
      },
      operations: operations.filter(({ transactionHash }) => transactionHash !== zeroHash),
      timestamp,
      type,
      settled: !!flow.completed,
      usdAmount,
    };
  }),
);

const CardActivity = pipe(
  variant("type", [
    object({
      type: literal("panda"),
      action: picklist(["created", "completed", "updated"]),
      createdAt: pipe(string(), isoTimestamp()),
      body: object({
        id: string(),
        spend: object({
          amount: number(),
          authorizedAmount: nullish(number()),
          currency: literal("usd"),
          localAmount: number(),
          localCurrency: string(),
          merchantCity: nullish(string()),
          merchantCountry: nullish(string()),
          merchantName: string(),
          authorizationUpdateAmount: optional(number()),
          enrichedMerchantIcon: optional(string()),
        }),
      }),
      forceCapture: boolean(),
      hash: Hash,
    }),
    object({
      type: literal("cryptomate"),
      operation_id: string(),
      data: object({
        created_at: pipe(string(), isoTimestamp()),
        bill_amount: number(),
        merchant_data: object({
          name: string(),
          country: nullish(string()),
          state: nullish(string()),
          city: nullish(string()),
        }),
        transaction_amount: number(),
        transaction_currency_code: nullish(string()),
      }),
      hash: Hash,
    }),
  ]),
  transform((activity) =>
    activity.type === "panda" ? activity : { ...activity, createdAt: activity.data.created_at },
  ),
);

function transformBorrow(borrow: InferOutput<typeof Borrow>, timestamp: bigint) {
  return {
    assets: Number(borrow.assets) / 1e6,
    fee: Number(borrow.fee) / 1e6,
    maturity: Number(borrow.maturity),
    rate: Number(fixedRate(borrow.maturity, borrow.assets, borrow.fee, timestamp)) / 1e18,
  };
}

function transformCard(activity: InferOutput<typeof CardActivity>) {
  if (activity.type === "panda") {
    const usdAmount =
      (function () {
        if (activity.action === "completed") {
          if (activity.forceCapture) return activity.body.spend.amount;
          return activity.body.spend.amount - (activity.body.spend.authorizedAmount ?? 0);
        }
        return activity.body.spend.authorizationUpdateAmount ?? activity.body.spend.amount;
      })() / 100;
    const exchangeRate =
      activity.body.spend.amount === 0 ? 1 : activity.body.spend.localAmount / activity.body.spend.amount;
    return {
      type: "card" as const,
      action: activity.action,
      id: activity.body.id,
      transactionHash: activity.hash,
      timestamp: activity.createdAt,
      currency: activity.body.spend.localCurrency.toUpperCase(),
      exchangeRate,
      amount: usdAmount * exchangeRate,
      usdAmount,
      merchant: {
        name: activity.body.spend.merchantName,
        city: activity.body.spend.merchantCity,
        country: activity.body.spend.merchantCountry,
        icon: activity.body.spend.enrichedMerchantIcon,
        state: "",
      },
    };
  }
  return {
    type: "card" as const,
    id: activity.operation_id,
    transactionHash: activity.hash,
    timestamp: activity.data.created_at,
    currency: activity.data.transaction_currency_code,
    amount: activity.data.transaction_amount,
    usdAmount: activity.data.bill_amount,
    merchant: {
      name: activity.data.merchant_data.name,
      city: activity.data.merchant_data.city,
      country: activity.data.merchant_data.country,
      state: activity.data.merchant_data.state,
    },
  };
}

export const DebitActivity = pipe(
  intersect([CardActivity, object({ events: undefined_(), blockTimestamp: undefined_() })]),
  transform((activity) => ({ ...transformCard(activity), mode: 0 as const })),
);

export const CreditActivity = pipe(
  intersect([CardActivity, object({ events: pipe(array(Borrow), length(1)), blockTimestamp: optional(bigint()) })]),
  transform((activity) => ({
    ...transformCard(activity),
    mode: 1 as const,
    borrow: transformBorrow(
      activity.events[0]!, // eslint-disable-line @typescript-eslint/no-non-null-assertion
      activity.blockTimestamp ?? BigInt(Math.floor(new Date(activity.createdAt).getTime() / 1000)),
    ),
  })),
);

export const InstallmentsActivity = pipe(
  intersect([CardActivity, object({ events: pipe(array(Borrow), minLength(2)), blockTimestamp: optional(bigint()) })]),
  transform((activity) => {
    const { createdAt, events, blockTimestamp } = activity;
    const timestamp = blockTimestamp ?? BigInt(Math.floor(new Date(createdAt).getTime() / 1000));
    events.sort((a, b) => Number(a.maturity) - Number(b.maturity));
    return {
      ...transformCard(activity),
      mode: events.length,
      borrow: {
        fee: Number(events.reduce((sum, { fee }) => sum + fee, 0n)) / 1e6,
        rate:
          Number(
            effectiveRate(
              events.reduce((sum, { assets }) => sum + assets, 0n),
              Number(events[0]!.maturity), // eslint-disable-line @typescript-eslint/no-non-null-assertion
              events.map(({ assets, fee }) => assets + fee),
              events.map((borrow) => fixedRate(borrow.maturity, borrow.assets, borrow.fee, timestamp)),
              Number(timestamp),
            ),
          ) / 1e18,
        installments: events.map((borrow) => transformBorrow(borrow, timestamp)),
      },
    };
  }),
);

export const OnchainActivity = object({
  args: object({ assets: bigint() }),
  market: object({ decimals: number(), symbol: string(), usdPrice: bigint() }),
  blockNumber: bigint(),
  transactionHash: Hash,
  transactionIndex: number(),
  logIndex: number(),
});

function transformActivity({
  args: { assets: value },
  market: { decimals, symbol, usdPrice },
  blockNumber,
  transactionHash,
  transactionIndex,
  logIndex,
}: InferOutput<typeof OnchainActivity>) {
  const baseUnit = 10 ** decimals;
  return {
    id: `${chain.id}:${String(blockNumber)}:${transactionIndex}:${logIndex}`,
    currency: symbol,
    amount: Number(value) / baseUnit,
    usdAmount: Number((value * usdPrice) / WAD) / baseUnit,
    blockNumber,
    transactionHash,
  };
}

export const DepositActivity = pipe(
  OnchainActivity,
  transform((activity) => ({ ...transformActivity(activity), type: "received" as const })),
);

export const RepayActivity = pipe(
  object({ ...OnchainActivity.entries, args: object({ assets: bigint(), positionAssets: bigint() }) }),
  transform((activity) => ({
    ...transformActivity(activity),
    positionAmount: Number(activity.args.positionAssets) / 10 ** activity.market.decimals,
    type: "repay" as const,
  })),
);

export const WithdrawActivity = pipe(
  object({ ...OnchainActivity.entries, args: object({ assets: bigint(), receiver: Address }) }),
  transform((activity) => ({
    ...transformActivity(activity),
    receiver: activity.args.receiver,
    type: "sent" as const,
  })),
);

function forbid<T extends object>(value: T) {
  return new Proxy<T>(value, {
    /* v8 ignore start */
    get(target, property) {
      // @ts-expect-error forward the getter
      if (property === "then") return target[property]; // eslint-disable-line @typescript-eslint/no-unsafe-return
      throw new Error("implementation error");
    },
    set() {
      throw new Error("implementation error");
    },
    /* v8 ignore end */
  });
}

function toArrayBuffer(buffer: ArrayBufferLike) {
  if (buffer instanceof ArrayBuffer) {
    return buffer;
  } else if (buffer instanceof SharedArrayBuffer) {
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    const view = new Uint8Array(arrayBuffer);
    view.set(new Uint8Array(buffer));
    return arrayBuffer;
  }
  throw new Error("unsupported buffer type");
}

/* eslint-disable @typescript-eslint/no-redeclare */
export type CreditActivity = InferOutput<typeof CreditActivity>;
export type DebitActivity = InferOutput<typeof DebitActivity>;
export type DepositActivity = InferOutput<typeof DepositActivity>;
export type InstallmentsActivity = InferOutput<typeof InstallmentsActivity>;
export type OnchainActivity = InferOutput<typeof OnchainActivity>;
export type PandaActivity = InferOutput<typeof PandaActivity>;
export type RepayActivity = InferOutput<typeof RepayActivity>;
export type WithdrawActivity = InferOutput<typeof WithdrawActivity>;
/* eslint-enable @typescript-eslint/no-redeclare */
