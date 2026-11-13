import { renderToBuffer } from "@react-pdf/renderer";

import { captureException, setUser } from "@sentry/node";
import { and, arrayOverlaps, eq, getViewSelectedFields, gt, inArray, min, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { accepts } from "hono/accepts";
import { validator as vValidator } from "hono-openapi/valibot";
import {
  array,
  bigint,
  boolean,
  check,
  digits,
  flatten,
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
  omit,
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
  type InferInput,
  type InferOutput,
} from "valibot";
import { decodeFunctionData, zeroHash } from "viem";

import fixedRate from "@exactly/common/fixedRate";
import chain, {
  debtManagerAddress,
  exaPluginAbi,
  marketUSDCAddress,
  marketWETHAddress,
} from "@exactly/common/generated/chain";
import { decodeWithdraw } from "@exactly/common/ProposalType";
import { Address, Hash, type Hex } from "@exactly/common/validation";
import { effectiveRate, WAD } from "@exactly/lib";

import * as indexer from "../database/indexer";
import { cards, credentials, transactions } from "../database/schema";
import { collectors as cryptomateCollectors } from "../utils/cryptomate";
import { declineMessage, collectors as pandaCollectors } from "../utils/panda";
import Statement from "../utils/Statement";
import validatorHook from "../utils/validatorHook";

import type * as schema from "../database/schema";
import type { Auth } from "../middleware/auth";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const ActivityTypes = picklist([
  "card",
  "received",
  "repay",
  "sent",
  "loan",
  "rollover",
  "swap",
  "liquidation",
  "bridge",
]);
const legacyTypes = new Set<InferInput<typeof ActivityTypes>>(["card", "received", "repay", "sent"]);

const fromToken = alias(indexer.tokens, "from_token");
const toToken = alias(indexer.tokens, "to_token");

const collectors = new Set([...cryptomateCollectors, ...pandaCollectors()].map((a) => a.toLowerCase() as Hex));

export default function route({ auth, database }: { auth: Auth; database: NodePgDatabase<typeof schema> }) {
  return new Hono().get(
    "/",
    auth,
    vValidator(
      "query",
      optional(
        object({
          include: optional(union([ActivityTypes, array(ActivityTypes)])),
          maturity: optional(pipe(string(), digits(), transform(Number))),
          timezone: optional(pipe(string(), check(isTimeZone, "invalid timezone"))),
        }),
        {},
      ),
      validatorHook(),
    ),
    async (c) => {
      const { include, maturity, timezone } = c.req.valid("query");
      if (maturity !== undefined && maturity > 864e10) return c.json({ code: "invalid maturity" }, 400);
      function ignore(type: InferInput<typeof ActivityTypes>) {
        if (!include) return !legacyTypes.has(type);
        return Array.isArray(include) ? !include.includes(type) : include !== type;
      }

      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { account: true },
        with: {
          cards: {
            columns: { id: true, lastFour: true },
            with: { transactions: { columns: { hashes: true, payload: true } } },
            limit: ignore("card") || maturity !== undefined ? 0 : undefined,
          },
        },
      });
      if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
      const account = parse(Address, credential.account);
      setUser({ id: account });

      const owner = account.toLowerCase() as Hex;
      const [markets, plugins] = await Promise.all([
        database
          .select({
            address: indexer.markets.address,
            symbol: indexer.markets.symbol,
            decimals: indexer.markets.decimals,
          })
          .from(indexer.markets)
          .where(eq(indexer.markets.chainId, chain.id))
          .then((rows) => new Map(rows.map(({ address, ...m }) => [address, m]))),
        !ignore("repay") || !ignore("sent") || !ignore("received")
          ? Promise.all([
              database
                .select({ plugin: indexer.accounts.owner })
                .from(indexer.accounts)
                .where(and(eq(indexer.accounts.chainId, chain.id), eq(indexer.accounts.address, owner))),
              database
                .select({ plugin: indexer.plugins.address })
                .from(indexer.plugins)
                .innerJoin(
                  indexer.exaPlugins,
                  and(
                    eq(indexer.exaPlugins.chainId, indexer.plugins.chainId),
                    eq(indexer.exaPlugins.address, indexer.plugins.address),
                  ),
                )
                .where(and(eq(indexer.plugins.chainId, chain.id), eq(indexer.plugins.account, owner))),
            ]).then(([owners, installed]) => new Set([...owners, ...installed].flatMap(({ plugin }) => plugin ?? [])))
          : Promise.resolve(forbid(new Set<Hex>())),
      ]);

      const market = (address: Hex, usdPrice: bigint) => {
        const found = markets.get(address.toLowerCase() as Hex);
        if (!found) throw new Error("market not found");
        return { ...found, usdPrice };
      };

      const repayPromise =
        !ignore("repay") || !ignore("received")
          ? database
              .select()
              .from(indexer.repays)
              .where(
                and(
                  eq(indexer.repays.chainId, chain.id),
                  eq(indexer.repays.account, owner),
                  inArray(indexer.repays.caller, [...plugins, debtManagerAddress.toLowerCase() as Hex]),
                  inArray(indexer.repays.market, [...markets.keys()]),
                ),
              )
              .orderBy(indexer.repays.block, indexer.repays.logIndex)
          : Promise.resolve(forbid([]));

      const nextBorrow = database
        .select({
          chainId: indexer.borrows.chainId,
          account: indexer.borrows.account,
          hash: indexer.borrows.hash,
          market: indexer.borrows.market,
          caller: indexer.borrows.caller,
          logIndex: indexer.borrows.logIndex,
        })
        .from(indexer.borrows)
        .as("next_borrow");
      const rolloverPromise = ignore("rollover")
        ? Promise.resolve(forbid([]))
        : database
            .select({
              repay: getViewSelectedFields(indexer.repays),
              borrow: {
                maturity: indexer.borrows.maturity,
                assets: indexer.borrows.assets,
                fee: indexer.borrows.fee,
              },
            })
            .from(indexer.repays)
            .innerJoin(
              indexer.borrows,
              and(
                eq(indexer.borrows.chainId, indexer.repays.chainId),
                eq(indexer.borrows.hash, indexer.repays.hash),
                eq(
                  indexer.borrows.logIndex,
                  database
                    .select({ logIndex: min(nextBorrow.logIndex) })
                    .from(nextBorrow)
                    .where(
                      and(
                        eq(nextBorrow.chainId, indexer.repays.chainId),
                        eq(nextBorrow.account, indexer.repays.account),
                        eq(nextBorrow.hash, indexer.repays.hash),
                        eq(nextBorrow.market, indexer.repays.market),
                        eq(nextBorrow.caller, indexer.repays.caller),
                        gt(nextBorrow.logIndex, indexer.repays.logIndex),
                      ),
                    ),
                ),
              ),
            )
            .where(
              and(
                eq(indexer.repays.chainId, chain.id),
                eq(indexer.repays.account, owner),
                eq(indexer.repays.caller, debtManagerAddress.toLowerCase() as Hex),
                inArray(indexer.repays.market, [...markets.keys()]),
              ),
            );

      const swapPromise = ignore("swap")
        ? Promise.resolve(forbid([]))
        : database
            .select({
              swap: getViewSelectedFields(indexer.swaps),
              from: { symbol: fromToken.symbol, decimals: fromToken.decimals },
              to: { symbol: toToken.symbol, decimals: toToken.decimals },
            })
            .from(indexer.swaps)
            .innerJoin(
              fromToken,
              and(eq(fromToken.chainId, indexer.swaps.chainId), eq(fromToken.address, indexer.swaps.fromAsset)),
            )
            .innerJoin(
              toToken,
              and(eq(toToken.chainId, indexer.swaps.chainId), eq(toToken.address, indexer.swaps.toAsset)),
            )
            .where(and(eq(indexer.swaps.chainId, chain.id), eq(indexer.swaps.account, owner)));

      const [deposits, repays, withdraws, borrows, loans, rollovers, swapped, liquidated, bridged] = await Promise.all([
        ignore("received")
          ? []
          : Promise.all([
              database
                .select()
                .from(indexer.deposits)
                .where(
                  and(
                    eq(indexer.deposits.chainId, chain.id),
                    eq(indexer.deposits.account, owner),
                    eq(indexer.deposits.caller, owner),
                    inArray(indexer.deposits.market, [...markets.keys()]),
                  ),
                )
                .orderBy(indexer.deposits.block, indexer.deposits.logIndex),
              repayPromise,
            ]).then(([deposit, repay]) =>
              deposit
                .filter(({ hash }) => !repay.some(({ hash: repayHash }) => repayHash === hash))
                .map((row) => parse(DepositActivity, { ...row, market: market(row.market, row.usdPrice) })),
            ),
        ignore("repay")
          ? []
          : Promise.all([repayPromise, ignore("rollover") ? [] : rolloverPromise]).then(([rows, rolled]) =>
              rows
                .filter((row) => !rolled.some(({ repay }) => repay.id === row.id))
                .filter((row) => maturity === undefined || Number(row.maturity) === maturity)
                .map((row) => parse(RepayActivity, { ...row, market: market(row.market, row.usdPrice) })),
            ),
        ignore("sent")
          ? []
          : Promise.all([
              database
                .select()
                .from(indexer.withdraws)
                .where(
                  and(
                    eq(indexer.withdraws.chainId, chain.id),
                    eq(indexer.withdraws.account, owner),
                    eq(indexer.withdraws.caller, owner),
                    inArray(indexer.withdraws.market, [...markets.keys()]),
                  ),
                )
                .orderBy(indexer.withdraws.block, indexer.withdraws.logIndex),
              database
                .select()
                .from(indexer.proposals)
                .where(
                  and(
                    eq(indexer.proposals.chainId, chain.id),
                    eq(indexer.proposals.account, owner),
                    eq(indexer.proposals.market, marketWETHAddress.toLowerCase() as Hex),
                  ),
                ),
            ]).then(([withdraw, proposed]) =>
              withdraw
                .map((row) => {
                  if (!collectors.has(row.receiver) && !plugins.has(row.receiver) && row.receiver !== owner) return row;
                  if (row.market !== marketWETHAddress.toLowerCase() || !plugins.has(row.receiver)) return;
                  if (row.input === null || row.input === "0x3ccfd60b") return row;
                  const { functionName, args } = decodeFunctionData({ data: row.input, abi: exaPluginAbi });
                  if (functionName !== "executeProposal") return;
                  const proposal = proposed.find(
                    ({ proposalManager, nonce }) => proposalManager === row.proposalManager && nonce === args[0],
                  );
                  if (!proposal) return;
                  return { ...row, receiver: decodeWithdraw(proposal.data), assets: proposal.amount };
                })
                .filter((row) => !!row)
                .map((row) => parse(WithdrawActivity, { ...row, market: market(row.market, row.usdPrice) })),
            ),
        ignore("card")
          ? undefined
          : database
              .select()
              .from(indexer.borrows)
              .where(
                and(
                  eq(indexer.borrows.chainId, chain.id),
                  eq(indexer.borrows.account, owner),
                  eq(indexer.borrows.market, marketUSDCAddress.toLowerCase() as Hex),
                ),
              )
              .orderBy(indexer.borrows.block, indexer.borrows.logIndex)
              .then((rows) =>
                rows.reduce((map, { hash, timestamp, maturity: m, assets, fee }) => {
                  const data = map.get(hash);
                  if (!data) return map.set(hash, { timestamp, events: [{ maturity: m, assets, fee }] });
                  data.events.push({ maturity: m, assets, fee });
                  return map;
                }, new Map<Hash, { events: { assets: bigint; fee: bigint; maturity: bigint }[]; timestamp: bigint }>()),
              ),
        ignore("loan")
          ? []
          : Promise.all([
              database
                .select()
                .from(indexer.borrows)
                .where(
                  and(
                    eq(indexer.borrows.chainId, chain.id),
                    eq(indexer.borrows.account, owner),
                    eq(indexer.borrows.caller, owner),
                    inArray(indexer.borrows.market, [...markets.keys()]),
                  ),
                )
                .orderBy(indexer.borrows.block, indexer.borrows.logIndex),
              database
                .select({ address: indexer.collectors.address })
                .from(indexer.collectors)
                .where(eq(indexer.collectors.chainId, chain.id)),
            ]).then(([rows, indexed]) => {
              const known = new Set([...collectors, ...indexed.map(({ address }) => address)]);
              return rows
                .filter(({ receiver }) => !known.has(receiver))
                .map((row) => parse(LoanActivity, { ...row, market: market(row.market, row.usdPrice) }));
            }),
        ignore("rollover")
          ? []
          : rolloverPromise.then((rows) =>
              rows.map(({ repay, borrow }) =>
                parse(RolloverActivity, { ...repay, market: market(repay.market, repay.usdPrice), borrow }),
              ),
            ),
        ignore("swap")
          ? []
          : swapPromise.then((rows) => rows.map(({ swap, from, to }) => parse(SwapActivity, { ...swap, from, to }))),
        ignore("liquidation")
          ? []
          : database
              .select()
              .from(indexer.liquidations)
              .where(
                and(
                  eq(indexer.liquidations.chainId, chain.id),
                  eq(indexer.liquidations.account, owner),
                  inArray(indexer.liquidations.market, [...markets.keys()]),
                  inArray(indexer.liquidations.seizeMarket, [...markets.keys()]),
                ),
              )
              .then((rows) =>
                rows.map((row) =>
                  parse(LiquidationActivity, {
                    ...row,
                    market: market(row.market, row.usdPrice),
                    seizeMarket: market(row.seizeMarket, row.seizeUsdPrice),
                  }),
                ),
              ),
        ignore("bridge")
          ? []
          : database
              .select({
                bridge: getViewSelectedFields(indexer.bridges),
                token: { symbol: indexer.tokens.symbol, decimals: indexer.tokens.decimals },
              })
              .from(indexer.bridges)
              .innerJoin(
                indexer.tokens,
                and(
                  eq(indexer.tokens.chainId, indexer.bridges.chainId),
                  eq(indexer.tokens.address, indexer.bridges.asset),
                ),
              )
              .where(
                or(
                  and(eq(indexer.bridges.chainId, chain.id), eq(indexer.bridges.account, owner)),
                  and(eq(indexer.bridges.destinationChainId, BigInt(chain.id)), eq(indexer.bridges.receiver, owner)),
                ),
              )
              .then((rows) =>
                rows.map(({ bridge, token }) => parse(BridgeActivity, { ...bridge, assets: bridge.amount, token })),
              ),
      ]);
      const purchases =
        !ignore("card") && borrows && maturity !== undefined
          ? await (() => {
              const hashes = borrows
                .entries()
                .filter(([_, { events }]) => events.some(({ maturity: m }) => Number(m) === maturity))
                .map(([hash]) => hash)
                .toArray();
              if (hashes.length === 0) return [];
              return database.query.cards.findMany({
                where: eq(cards.credentialId, credentialId),
                columns: { id: true, lastFour: true },
                with: {
                  transactions: {
                    columns: { hashes: true, payload: true },
                    where: arrayOverlaps(transactions.hashes, hashes),
                  },
                },
              });
            })()
          : credential.cards;

      const accept = accepts(c, {
        header: "Accept",
        supports: maturity === undefined ? ["application/json"] : ["application/json", "application/pdf"],
        default: "application/json",
      });
      const pdf = accept === "application/pdf";

      const response = [
        ...purchases.flatMap(({ id: cardId, lastFour, transactions: txs }) =>
          txs.map(({ hashes, payload }) => {
            const panda = safeParse(PandaActivity, {
              ...(payload as object),
              hashes,
              borrows: hashes.map((h) => {
                const b = borrows?.get(h as Hash);
                if (!b) return null;
                const filtered =
                  maturity === undefined ? b.events : b.events.filter(({ maturity: m }) => Number(m) === maturity);
                if (filtered.length === 0) return null;
                return {
                  events: maturity !== undefined && b.events.length > 1 ? b.events : filtered,
                  timestamp: b.timestamp,
                };
              }),
            });
            if (panda.success) {
              if (maturity === undefined || pdf) return { ...panda.output, cardId, lastFour };
              const operations: typeof panda.output.operations = [];
              for (const operation of panda.output.operations) {
                if (!("borrow" in operation)) continue;
                const { borrow } = operation;
                if (!("installments" in borrow)) {
                  const event = borrows?.get(operation.transactionHash)?.events[0];
                  if (event && Number(event.maturity) === maturity) operations.push(operation);
                  continue;
                }
                const raw = borrows?.get(operation.transactionHash)?.events;
                if (!raw) continue;
                const sorted = raw.toSorted((a, b) => Number(a.maturity) - Number(b.maturity));
                const installments = sorted.flatMap((event, n) => {
                  const installment = borrow.installments[n];
                  if (Number(event.maturity) !== maturity || !installment) return [];
                  return [installment];
                });
                if (installments.length === 0) continue;
                const usdAmount = raw.reduce(
                  (sum, { assets, maturity: m }) => (Number(m) === maturity ? sum + Number(assets) / 1e6 : sum),
                  0,
                );
                const exchangeRate = operation.usdAmount === 0 ? 1 : operation.amount / operation.usdAmount;
                operations.push({
                  ...operation,
                  amount: usdAmount * exchangeRate,
                  borrow: {
                    ...operation.borrow,
                    fee: installments.reduce((sum, { fee }) => sum + fee, 0),
                    rate: installments.reduce((sum, { rate }) => sum + rate, 0) / installments.length,
                    installments,
                  },
                  usdAmount,
                });
              }
              if (operations.length === 0) return;
              return {
                ...panda.output,
                amount: operations.reduce((sum, { amount }) => sum + amount, 0),
                cardId,
                lastFour,
                operations,
                usdAmount: operations.reduce((sum, { usdAmount }) => sum + usdAmount, 0),
              };
            }

            if (hashes.length !== 1) throw new Error("cryptomate transactions need to have only one hash");
            const hash = hashes[0];
            const borrow = borrows?.get(hash as Hash);
            const filtered =
              maturity === undefined || !borrow
                ? borrow?.events
                : borrow.events.filter(({ maturity: m }) => Number(m) === maturity);
            if (maturity !== undefined && borrow && filtered?.length === 0) return;
            const events = !borrow || maturity === undefined || borrow.events.length <= 1 ? filtered : borrow.events;
            const cryptomate = safeParse(
              { 0: DebitActivity, 1: CreditActivity }[events?.length ?? 0] ?? InstallmentsActivity,
              {
                ...(payload as object),
                hash,
                events,
                blockTimestamp: borrow?.timestamp,
              },
            );
            if (cryptomate.success) {
              if (maturity === undefined || pdf) return { ...cryptomate.output, cardId, lastFour };
              if (!borrow) return;
              if (borrow.events.length <= 1) return { ...cryptomate.output, cardId, lastFour };
              if (!("borrow" in cryptomate.output) || !("installments" in cryptomate.output.borrow))
                return { ...cryptomate.output, cardId, lastFour };
              const { borrow: outputBorrow } = cryptomate.output;
              const sortedEvents = borrow.events.toSorted((a, b) => Number(a.maturity) - Number(b.maturity));
              const installments = sortedEvents.flatMap((event, n) => {
                const installment = outputBorrow.installments[n];
                if (Number(event.maturity) !== maturity || !installment) return [];
                return [installment];
              });
              if (installments.length === 0) return;
              const usdAmount = borrow.events.reduce(
                (sum, { assets, maturity: m }) => (Number(m) === maturity ? sum + Number(assets) / 1e6 : sum),
                0,
              );
              const exchangeRate =
                cryptomate.output.usdAmount === 0 ? 1 : cryptomate.output.amount / cryptomate.output.usdAmount;
              return {
                ...cryptomate.output,
                amount: usdAmount * exchangeRate,
                borrow: {
                  ...outputBorrow,
                  fee: installments.reduce((sum, { fee }) => sum + fee, 0),
                  rate: installments.reduce((sum, { rate }) => sum + rate, 0) / installments.length,
                  installments,
                },
                cardId,
                lastFour,
                usdAmount,
              };
            }
            captureException(new Error("bad transaction"), {
              level: "error",
              contexts: {
                cryptomate: { success: cryptomate.success, ...flatten(cryptomate.issues) },
                panda: { success: panda.success, ...flatten(panda.issues) },
              },
            });
          }),
        ),
        ...deposits,
        ...repays,
        ...withdraws,
        ...loans,
        ...rollovers,
        ...swapped,
        ...liquidated,
        ...bridged,
      ]
        .filter(<T>(value: T | undefined): value is T => value !== undefined)
        .toSorted((a, b) => b.timestamp.localeCompare(a.timestamp) || collator.compare(b.id, a.id));

      if (maturity !== undefined && pdf) {
        const purchasesByCard = Map.groupBy(
          response.flatMap((item) => {
            if (item.type !== "panda" && (item.type !== "card" || !("borrow" in item))) return [];
            const installments = (item.type === "panda" ? item.operations : [item])
              .reduce((accumulator, operation) => {
                if (!("borrow" in operation)) return accumulator;
                const { borrow } = operation;
                for (const { amount, current, total } of "installments" in borrow
                  ? borrow.installments.flatMap((installment) =>
                      installment.maturity === maturity ? [{ ...installment, total: borrow.installments.length }] : [],
                    )
                  : [{ amount: borrow.amount, current: 1, total: 1 }]) {
                  const status = accumulator.get(`${current}/${total}`) ?? { current, total, amount: 0 };
                  status.amount += amount;
                  accumulator.set(`${current}/${total}`, status);
                }
                return accumulator;
              }, new Map<string, { amount: number; current: number; total: number }>())
              .values()
              .toArray();
            return [
              {
                cardId: item.cardId,
                id: item.id,
                timestamp: item.timestamp,
                description: `${item.merchant.name}${item.merchant.city ? `, ${item.merchant.city}` : ""}`,
                installments,
              },
            ];
          }),
          ({ cardId }) => cardId,
        );
        const statement = {
          account: `${account.slice(0, 6)}...${account.slice(-6)}`,
          maturity,
          cards: purchases
            .filter(({ id }) => purchasesByCard.has(id))
            .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
            .map(({ id, lastFour }) => ({
              id,
              lastFour,
              purchases: (purchasesByCard.get(id) ?? []).map(({ cardId: _, ...rest }) => rest),
            })),
          payments: response
            .filter((item) => item.type === "repay")
            .filter((repay) => repay.currency === markets.get(marketUSDCAddress.toLowerCase() as Hex)?.symbol)
            .map(({ id, timestamp, amount, positionAmount }) => ({
              id,
              timestamp,
              amount,
              positionAmount,
            })),
          timeZone: timezone,
        };
        return c.body(new Uint8Array(await renderToBuffer(Statement(statement))), 200, {
          "content-type": "application/pdf",
        });
      }
      return c.json(response, 200);
    },
  );
}

const Borrow = object({ maturity: bigint(), assets: bigint(), fee: bigint() });

export const PandaActivity = pipe(
  object({
    bodies: array(
      looseObject({
        action: picklist(["completed", "created", "requested", "updated"]),
        body: looseObject({
          spend: looseObject({ declinedReason: nullish(string()) }),
        }),
        reason: optional(string()),
        status: optional(string()),
      }),
    ),
    borrows: array(nullable(object({ timestamp: optional(bigint()), events: array(Borrow) }))),
    hashes: array(Hash),
    type: literal("panda"),
  }),
  transform(({ bodies, borrows, hashes, type }) => {
    const requestedBody = bodies.findLast((body) => body.action === "requested" && body.status === "declined");
    const requestedReason = requestedBody?.body.spend.declinedReason ?? requestedBody?.reason;
    const operations = hashes
      .map((hash, index) => {
        const borrow = borrows[index];
        const body = bodies[index];
        const declinedReason =
          body?.body.spend.declinedReason?.toLowerCase() === "webhook declined"
            ? (requestedReason ?? body.body.spend.declinedReason)
            : body?.body.spend.declinedReason;
        const validation = safeParse(
          { 0: DebitActivity, 1: CreditActivity }[borrow?.events.length ?? 0] ?? InstallmentsActivity,
          {
            ...body,
            ...(body?.status === "declined" && {
              reason:
                declineMessage(declinedReason) ??
                body.reason ??
                (declinedReason === "" ? "transaction declined" : declinedReason) ??
                "transaction declined",
            }),
            forceCapture: body?.action === "completed" && !bodies.some((b) => b.action === "created"),
            type,
            hash,
            events: borrow?.events,
            blockTimestamp: borrow?.timestamp,
          },
        );
        if (validation.success) return validation.output;
        throw new Error("bad panda activity");
      })
      .filter((p) => p.provider === "panda");

    const declined = (function () {
      const operation = operations.findLast((b) => b.action === "created" && b.status === "declined");
      if (operation) {
        if (operation.reason === "webhook declined") {
          const requested = operations.findLast((b) => b.action === "requested");
          return requested
            ? { ...operation, reason: requested.reason }
            : { ...operation, reason: "transaction declined" };
        }
        return operation;
      }
      return operations.findLast((b) => b.action === "requested");
    })();

    const flow = operations.reduce<{
      completed: (typeof operations)[number] | undefined;
      created: (typeof operations)[number] | undefined;
      updates: (typeof operations)[number][];
    }>(
      (f, operation) => {
        switch (operation.action) {
          case "updated":
            f.updates.push(operation);
            break;

          case "created":
          case "completed":
            f[operation.action] = operation;
            break;

          case "requested":
            return f;
          default:
            throw new Error("bad action");
        }
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
    const usdAmount = operations
      .filter((op) => op.action !== "requested")
      .reduce((sum, { usdAmount: amount }) => sum + amount, 0);
    const exchangeRate = flow.completed?.exchangeRate ?? [flow.created, ...flow.updates].at(-1)?.exchangeRate;
    if (exchangeRate === undefined) throw new Error("no exchange rate");
    return {
      id,
      currency,
      amount: usdAmount * exchangeRate,
      merchant: {
        name: name.trim(),
        city: city?.trim(),
        country: country?.trim(),
        state: state.trim(),
        icon: flow.completed?.merchant.icon ?? flow.updates.at(-1)?.merchant.icon,
      },
      operations: operations.filter(({ transactionHash }) => transactionHash !== zeroHash),
      timestamp,
      type,
      usdAmount,
      status: declined ? ("declined" as const) : flow.completed ? ("settled" as const) : ("pending" as const),
      ...(declined && { reason: declined.reason ?? "transaction declined" }),
    };
  }),
);

const PandaBase = {
  type: literal("panda"),
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
};

const CardActivity = pipe(
  variant("type", [
    pipe(
      variant("action", [
        object({ ...PandaBase, action: picklist(["completed", "updated"]) }),
        object({
          ...PandaBase,
          action: literal("created"),
          status: optional(literal("declined")),
          reason: optional(string()),
        }),
        object({ ...PandaBase, action: literal("requested"), status: literal("declined"), reason: string() }),
      ]),
    ),
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
    amount: Number(borrow.assets + borrow.fee) / 1e6,
    maturity: Number(borrow.maturity),
    fee: Number(borrow.fee) / 1e6,
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
      provider: "panda" as const,
      action: activity.action,
      id: activity.body.id,
      transactionHash: activity.hash,
      timestamp: activity.createdAt,
      currency:
        activity.body.spend.amount < 0 && activity.body.spend.localAmount === activity.body.spend.amount
          ? "USD"
          : activity.body.spend.localCurrency.toUpperCase(),
      exchangeRate,
      amount: usdAmount * exchangeRate,
      usdAmount,
      merchant: {
        name: activity.body.spend.merchantName,
        city: activity.body.spend.merchantCity,
        country: activity.body.spend.merchantCountry,
        state: "",
        icon: activity.body.spend.enrichedMerchantIcon,
      },
      ...((activity.action === "requested" || activity.action === "created") && {
        status: activity.status,
        reason: activity.reason,
      }),
    };
  }
  return {
    type: "card" as const,
    provider: "cryptomate" as const,
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
              events.map(({ maturity, assets, fee }) => fixedRate(maturity, assets, fee, timestamp)),
              Number(timestamp),
            ),
          ) / 1e18,
        installments: events.map((borrow, n) => ({ ...transformBorrow(borrow, timestamp), current: n + 1 })),
      },
    };
  }),
);

export const OnchainActivity = object({
  assets: bigint(),
  market: object({ decimals: number(), symbol: string(), usdPrice: bigint() }),
  block: bigint(),
  timestamp: bigint(),
  hash: Hash,
  transactionIndex: number(),
  logIndex: number(),
});

function transformActivity({
  assets: value,
  market: { decimals, symbol, usdPrice },
  block,
  timestamp,
  hash,
  transactionIndex,
  logIndex,
}: InferOutput<typeof OnchainActivity>) {
  const baseUnit = 10 ** decimals;
  return {
    id: `${chain.id}:${block}:${transactionIndex}:${logIndex}`,
    currency: symbol,
    amount: Number(value) / baseUnit,
    usdAmount: Number((value * usdPrice) / WAD) / baseUnit,
    timestamp: new Date(Number(timestamp) * 1000).toISOString(),
    transactionHash: hash,
  };
}

export const DepositActivity = pipe(
  OnchainActivity,
  transform((activity) => ({ ...transformActivity(activity), type: "received" as const })),
);

export const RepayActivity = pipe(
  object({ ...OnchainActivity.entries, positionAssets: bigint() }),
  transform((activity) => ({
    ...transformActivity(activity),
    positionAmount: Number(activity.positionAssets) / 10 ** activity.market.decimals,
    type: "repay" as const,
  })),
);

export const WithdrawActivity = pipe(
  object({ ...OnchainActivity.entries, receiver: Address }),
  transform((activity) => ({
    ...transformActivity(activity),
    receiver: activity.receiver,
    type: "sent" as const,
  })),
);

export const LoanActivity = pipe(
  object({ ...OnchainActivity.entries, maturity: bigint(), fee: bigint(), receiver: Address }),
  transform((activity) => ({
    ...transformActivity(activity),
    fee: Number(activity.fee) / 10 ** activity.market.decimals,
    maturity: Number(activity.maturity),
    rate: Number(fixedRate(activity.maturity, activity.assets, activity.fee, activity.timestamp)) / 1e18,
    receiver: activity.receiver,
    type: "loan" as const,
  })),
);

export const RolloverActivity = pipe(
  object({ ...OnchainActivity.entries, maturity: bigint(), positionAssets: bigint(), borrow: Borrow }),
  transform((activity) => {
    const { decimals } = activity.market;
    return {
      ...transformActivity(activity),
      positionAmount: Number(activity.positionAssets) / 10 ** decimals,
      maturity: Number(activity.maturity),
      borrow: {
        amount: Number(activity.borrow.assets + activity.borrow.fee) / 10 ** decimals,
        fee: Number(activity.borrow.fee) / 10 ** decimals,
        maturity: Number(activity.borrow.maturity),
        rate:
          Number(fixedRate(activity.borrow.maturity, activity.borrow.assets, activity.borrow.fee, activity.timestamp)) /
          1e18,
      },
      type: "rollover" as const,
    };
  }),
);

export const LiquidationActivity = pipe(
  object({ ...OnchainActivity.entries, seizeMarket: OnchainActivity.entries.market, seizedAssets: bigint() }),
  transform(({ seizeMarket, seizedAssets, ...activity }) => {
    const { currency, amount, usdAmount } = transformActivity({
      ...activity,
      assets: seizedAssets,
      market: seizeMarket,
    });
    return { ...transformActivity(activity), seize: { currency, amount, usdAmount }, type: "liquidation" as const };
  }),
);

const Token = object({ symbol: string(), decimals: number() });

export const SwapActivity = pipe(
  object({
    ...omit(OnchainActivity, ["assets", "market"]).entries,
    from: Token,
    to: Token,
    fromAmount: bigint(),
    toAmount: bigint(),
    fromUsdPrice: nullable(bigint()),
    toUsdPrice: nullable(bigint()),
  }),
  transform(({ from, to, fromAmount, toAmount, fromUsdPrice, toUsdPrice, ...activity }) => {
    const usd =
      toUsdPrice === null
        ? fromUsdPrice === null
          ? undefined
          : { assets: fromAmount, usdPrice: fromUsdPrice, decimals: from.decimals }
        : { assets: toAmount, usdPrice: toUsdPrice, decimals: to.decimals };
    return {
      ...transformActivity({ ...activity, assets: toAmount, market: { ...to, usdPrice: toUsdPrice ?? 0n } }),
      usdAmount: usd && Number((usd.assets * usd.usdPrice) / WAD) / 10 ** usd.decimals,
      from: { currency: from.symbol, amount: Number(fromAmount) / 10 ** from.decimals },
      type: "swap" as const,
    };
  }),
);

export const BridgeActivity = pipe(
  object({
    ...omit(OnchainActivity, ["market"]).entries,
    chainId: number(),
    token: Token,
    usdPrice: nullable(bigint()),
    bridge: string(),
    receiver: Address,
    destinationChainId: bigint(),
  }),
  transform(({ chainId, token, usdPrice, bridge, receiver, destinationChainId, ...activity }) => ({
    ...transformActivity({ ...activity, market: { ...token, usdPrice: usdPrice ?? 0n } }),
    id: `${chainId}:${activity.block}:${activity.transactionIndex}:${activity.logIndex}`,
    usdAmount: usdPrice === null ? undefined : Number((activity.assets * usdPrice) / WAD) / 10 ** token.decimals,
    bridge,
    receiver,
    sourceChainId: chainId,
    destinationChainId: Number(destinationChainId),
    type: "bridge" as const,
  })),
);

function forbid<T extends object>(value: T) {
  return new Proxy(value, {
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

const collator = new Intl.Collator(undefined, { numeric: true });

function isTimeZone(timeZone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone }).resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
}

export type BridgeActivity = InferOutput<typeof BridgeActivity>;
export type CreditActivity = InferOutput<typeof CreditActivity>;
export type DebitActivity = InferOutput<typeof DebitActivity>;
export type DepositActivity = InferOutput<typeof DepositActivity>;
export type InstallmentsActivity = InferOutput<typeof InstallmentsActivity>;
export type LiquidationActivity = InferOutput<typeof LiquidationActivity>;
export type LoanActivity = InferOutput<typeof LoanActivity>;
export type OnchainActivity = InferOutput<typeof OnchainActivity>;
export type PandaActivity = InferOutput<typeof PandaActivity>;
export type RepayActivity = InferOutput<typeof RepayActivity>;
export type RolloverActivity = InferOutput<typeof RolloverActivity>;
export type SwapActivity = InferOutput<typeof SwapActivity>;
export type WithdrawActivity = InferOutput<typeof WithdrawActivity>;
