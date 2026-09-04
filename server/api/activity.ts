import { renderToBuffer } from "@react-pdf/renderer";

import { captureException, setUser } from "@sentry/node";
import { arrayOverlaps, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { accepts } from "hono/accepts";
import { validator as vValidator } from "hono-openapi/valibot";
import {
  array,
  bigint,
  boolean,
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
import { decodeFunctionData, zeroHash, type Log } from "viem";

import fixedRate from "@exactly/common/fixedRate";
import chain, {
  debtManagerAddress,
  exaPluginAbi,
  exaPreviewerAbi,
  exaPreviewerAddress,
  marketAbi,
  marketUSDCAddress,
  marketWETHAddress,
  proposalManagerAbi,
  proposalManagerAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import { decodeWithdraw } from "@exactly/common/ProposalType";
import { Address, Hash, type Hex } from "@exactly/common/validation";
import { effectiveRate, MATURITY_INTERVAL, WAD } from "@exactly/lib";

import { cards, credentials, transactions } from "../database/schema";
import AccountStatement from "../utils/AccountStatement";
import { collectors as cryptomateCollectors } from "../utils/cryptomate";
import { declineMessage, collectors as pandaCollectors } from "../utils/panda";
import publicClient from "../utils/publicClient";
import Statement from "../utils/Statement";
import validatorHook from "../utils/validatorHook";

import type * as schema from "../database/schema";
import type { Auth } from "../middleware/auth";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const ActivityTypes = picklist(["card", "received", "repay", "sent"]);

const collectors = new Set([...cryptomateCollectors, ...pandaCollectors].map((a) => a.toLowerCase() as Hex));

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
        }),
        {},
      ),
      validatorHook(),
    ),
    async (c) => {
      const { include, maturity } = c.req.valid("query");
      if (maturity !== undefined && maturity > 864e10) return c.json({ code: "invalid maturity" }, 400);
      const pdf =
        accepts(c, {
          header: "Accept",
          supports: ["application/json", "application/pdf"],
          default: "application/json",
        }) === "application/pdf";
      const accountPdf = pdf && include === undefined;
      const eventMaturity = accountPdf ? undefined : maturity;
      if (pdf && include !== undefined && maturity === undefined)
        return c.json({ code: "maturity required for filtered pdf" }, 400);
      if (accountPdf && maturity === undefined)
        return c.json({ code: "maturity required for account statement pdf" }, 400);
      const period =
        maturity === undefined
          ? undefined
          : { end: new Date(maturity * 1000), start: new Date((maturity - MATURITY_INTERVAL) * 1000) };
      const fromBlock = accountPdf && period ? await findBlock(period.start) : 0n;
      const toBlock = accountPdf && period ? await findBlock(period.end, true) : "latest";
      const transactionPeriod =
        accountPdf && period
          ? sql`(
              (
                ${transactions.payload}->>'type' = 'cryptomate'
                AND (${transactions.payload}->'data'->>'created_at')::timestamptz > ${period.start} /* cspell:ignore timestamptz */
                AND (${transactions.payload}->'data'->>'created_at')::timestamptz <= ${period.end} /* cspell:ignore timestamptz */
              )
              OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(${transactions.payload}->'bodies', '[]'::jsonb)) AS body
                WHERE (body->>'createdAt')::timestamptz > ${period.start} /* cspell:ignore timestamptz */
                  AND (body->>'createdAt')::timestamptz <= ${period.end} /* cspell:ignore timestamptz */
              )
            )`
          : undefined;
      function ignore(type: InferInput<typeof ActivityTypes>) {
        return include && (Array.isArray(include) ? !include.includes(type) : include !== type);
      }

      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { account: true },
        with: {
          cards: {
            columns: { id: true, lastFour: true },
            with: { transactions: { columns: { hashes: true, payload: true }, where: transactionPeriod } },
            limit: ignore("card") || eventMaturity !== undefined ? 0 : undefined,
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
              args: { caller: [...plugins, debtManagerAddress], borrower: account },
              toBlock,
              fromBlock,
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
                  toBlock,
                  fromBlock,
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
              logs
                .filter(({ args }) => eventMaturity === undefined || Number(args.maturity) === eventMaturity)
                .map((log) =>
                  parse(RepayActivity, {
                    ...log,
                    market: market(log.address),
                  } satisfies InferInput<typeof RepayActivity>),
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
                toBlock,
                fromBlock,
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
                toBlock,
                fromBlock,
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
      const purchases =
        !ignore("card") && borrows && maturity !== undefined && !accountPdf
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
                  eventMaturity === undefined
                    ? b.events
                    : b.events.filter(({ maturity: m }) => Number(m) === eventMaturity);
                if (filtered.length === 0) return null;
                return {
                  events: eventMaturity !== undefined && b.events.length > 1 ? b.events : filtered,
                  timestamp: b.blockNumber && timestamps.get(b.blockNumber),
                };
              }),
            });
            if (panda.success) {
              if (eventMaturity === undefined || pdf) {
                const output = { ...panda.output, cardId, lastFour };
                Object.defineProperty(output, "completion", { value: stringAt(panda.output, "completion") });
                return output;
              }
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
              eventMaturity === undefined || !borrow
                ? borrow?.events
                : borrow.events.filter(({ maturity: m }) => Number(m) === eventMaturity);
            if (eventMaturity !== undefined && borrow && filtered?.length === 0) return;
            const events =
              !borrow || eventMaturity === undefined || borrow.events.length <= 1 ? filtered : borrow.events;
            const cryptomate = safeParse(
              { 0: DebitActivity, 1: CreditActivity }[events?.length ?? 0] ?? InstallmentsActivity,
              {
                ...(payload as object),
                hash,
                events,
                blockTimestamp: borrow?.blockNumber && timestamps.get(borrow.blockNumber),
              },
            );
            if (cryptomate.success) {
              if (eventMaturity === undefined || pdf) return { ...cryptomate.output, cardId, lastFour };
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
        .toSorted((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));

      if (accountPdf) {
        const items = response
          .flatMap((item): (typeof response)[number][] => {
            if (item.type !== "panda") return [item];
            const pending =
              item.status === "pending"
                ? item.operations.filter(
                    (operation) =>
                      operation.action === "updated" &&
                      stringAt(operation, "spendStatus") === "pending" &&
                      operation.usdAmount < 0,
                  )
                : [];
            const current =
              pending.length === 0
                ? item
                : {
                    ...item,
                    amount: item.amount - pending.reduce((sum, operation) => sum + operation.amount, 0),
                    operations: item.operations.filter((operation) => !pending.includes(operation)),
                    usdAmount: item.usdAmount - pending.reduce((sum, operation) => sum + operation.usdAmount, 0),
                  };
            const refunds = current.operations.filter(
              (operation) =>
                operation.usdAmount < 0 &&
                stringAt(operation, "spendStatus") !== "pending" &&
                stringAt(operation, "spendStatus") !== "reversed" &&
                (operation.action !== "completed" ||
                  isRefund(operation) ||
                  !current.operations.some(({ action }) => action === "created")),
            );
            const settledAt =
              current.operations.findLast(({ action, usdAmount: amount }) => action === "completed" && amount > 0)
                ?.timestamp ?? stringAt(item, "completion");
            const charges = current.operations.filter(
              (operation) => operation.usdAmount >= 0 || (operation.action === "completed" && !isRefund(operation)),
            );
            const chargeItems = Map.groupBy(charges, ({ mode }) => mode > 0)
              .values()
              .toArray()
              .flatMap((operations) => {
                const usdAmount = operations.reduce((sum, { usdAmount: amount }) => sum + amount, 0);
                if (usdAmount <= 0) return [];
                const completed = operations.findLast(({ action }) => action === "completed");
                return [
                  {
                    ...current,
                    amount: operations.reduce((sum, { amount }) => sum + amount, 0),
                    operations,
                    timestamp:
                      completed?.timestamp ??
                      stringAt(item, "completion") ??
                      operations.findLast(({ action }) => action === "created")?.timestamp ??
                      current.timestamp,
                    usdAmount,
                  },
                ];
              });
            const charged = chargeItems.map((charge, index) => ({
              ...charge,
              ...(index > 0 && { id: `${item.id}:${index}` }),
            }));
            if (refunds.length === 0)
              return charged.length > 0 ? charged : [settledAt ? { ...current, timestamp: settledAt } : current];
            return [
              ...charged,
              ...refunds.map((operation, index) => {
                const n = index + chargeItems.length;
                return {
                  ...current,
                  ...(n > 0 && { id: `${item.id}:${n}` }),
                  amount: operation.amount,
                  operations: [operation],
                  timestamp: operation.timestamp,
                  usdAmount: operation.usdAmount,
                };
              }),
            ];
          })
          .filter(
            (item) =>
              (item.type !== "panda" || item.status === "settled" || item.usdAmount < 0) &&
              (maturity === undefined ||
                (Date.parse(item.timestamp) / 1000 > maturity - MATURITY_INTERVAL &&
                  Date.parse(item.timestamp) / 1000 <= maturity)),
          );
        return c.body(
          new Uint8Array(
            await renderToBuffer(
              AccountStatement({
                account: mask(account),
                activities: items.map((item) => {
                  if ("merchant" in item) {
                    const movement = {
                      id: item.id,
                      timestamp: item.timestamp,
                      amount: -item.usdAmount,
                      title: item.merchant.name,
                    };
                    if (-item.usdAmount > 0) return { ...movement, detail: `Refund – Card **** ${item.lastFour}` };
                    if (item.type === "panda" ? item.operations.some(({ mode }) => mode > 0) : item.mode > 0)
                      return { ...movement, detail: `Credit purchase – Card **** ${item.lastFour}` };
                    return { ...movement, detail: `Debit purchase – Card **** ${item.lastFour}` };
                  }
                  switch (item.type) {
                    case "received":
                      return {
                        id: item.id,
                        timestamp: item.timestamp,
                        amount: item.usdAmount,
                        title: "Funds added",
                        detail: `${item.amount} ${item.currency}`,
                      };
                    case "repay":
                      return {
                        id: item.id,
                        timestamp: item.timestamp,
                        amount: -item.usdAmount,
                        title: "Debt payment",
                        detail: `${item.amount} ${item.currency}`,
                      };
                    case "sent":
                      return {
                        id: item.id,
                        timestamp: item.timestamp,
                        amount: -item.usdAmount,
                        title: `Sent to ${mask(item.receiver)}`,
                        detail: `${item.amount} ${item.currency}`,
                      };
                    default:
                      throw new Error("unsupported activity type", { cause: item });
                  }
                }),
                cards: [
                  ...Map.groupBy(
                    items.filter((item) => "merchant" in item),
                    ({ cardId }) => cardId,
                  ),
                ].map(([cardId, cardItems]) => ({
                  amount: cardItems.reduce(
                    (sum, item) =>
                      sum +
                      (item.usdAmount > 0 &&
                      (item.type === "panda" ? item.operations.every(({ mode }) => mode <= 0) : item.mode <= 0)
                        ? item.usdAmount
                        : 0),
                    0,
                  ),
                  lastFour: cardItems.at(0)?.lastFour ?? "",
                  cardId,
                })),
                period:
                  maturity === undefined
                    ? undefined
                    : new Intl.DateTimeFormat("en-US", {
                        day: "numeric",
                        month: "short",
                        timeZone: "UTC",
                        year: "numeric",
                      }).formatRange(new Date((maturity - MATURITY_INTERVAL) * 1000), new Date(maturity * 1000)),
              }),
            ),
          ),
          200,
          { "content-type": "application/pdf" },
        );
      }

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
        return c.body(
          new Uint8Array(
            await renderToBuffer(
              Statement({
                account: mask(account),
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
                  .filter((repay) => repay.currency === market(marketUSDCAddress).symbol)
                  .map(({ id, timestamp, amount, positionAmount }) => ({
                    id,
                    timestamp,
                    amount,
                    positionAmount,
                  })),
              }),
            ),
          ),
          200,
          {
            "content-type": "application/pdf",
          },
        );
      }
      return c.json(response, 200);
    },
  );
}

const Borrow = object({ maturity: bigint(), assets: bigint(), fee: bigint() });

type PandaMetadata = { completion?: string; refund?: boolean; spendStatus?: string; type: string };

function isRefund(operation: PandaMetadata) {
  return operation.refund === true;
}

function stringAt(activity: PandaMetadata, property: "completion" | "spendStatus") {
  const value = activity[property];
  return typeof value === "string" ? value : undefined;
}

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
              reason: declineMessage(declinedReason) ?? body.reason ?? "transaction declined",
            }),
            forceCapture: body?.action === "completed" && !bodies.some((b) => b.action === "created"),
            type,
            hash,
            events: borrow?.events,
            blockTimestamp: borrow?.timestamp,
          },
        );
        if (validation.success) {
          const amount = body?.body.spend.amount;
          Object.defineProperties(validation.output, {
            refund: { value: body?.action === "completed" && typeof amount === "number" && amount < 0 },
            spendStatus: { value: body?.body.spend.status },
          });
          return validation.output;
        }
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
    const result = {
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
    Object.defineProperty(result, "completion", {
      value: operations.findLast(
        ({ action, transactionHash }) => action === "completed" && transactionHash === zeroHash,
      )?.timestamp,
    });
    return result;
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
      status: optional(picklist(["completed", "declined", "pending", "reversed"])),
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
          if (activity.forceCapture || activity.body.spend.amount < 0) return activity.body.spend.amount;
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
      currency: activity.body.spend.localCurrency.toUpperCase(),
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
    id: `${chain.id}:${blockNumber}:${transactionIndex}:${logIndex}`,
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

async function findBlock(timestamp: Date, upper = false) {
  const target = BigInt(Math.floor(timestamp.getTime() / 1000));
  const latest = await publicClient.getBlock({ blockTag: "latest" });
  if (upper && latest.timestamp <= target) return latest.number;
  let low = 0n;
  let high = latest.number;
  while (low < high) {
    const blockNumber = (low + high) / 2n;
    const block = await publicClient.getBlock({ blockNumber });
    if (block.timestamp < target || (upper && block.timestamp === target)) low = blockNumber + 1n;
    else high = blockNumber;
  }
  return upper && low > 0n ? low - 1n : low;
}

function mask(address: Address) {
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

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

export type CreditActivity = InferOutput<typeof CreditActivity>;
export type DebitActivity = InferOutput<typeof DebitActivity>;
export type DepositActivity = InferOutput<typeof DepositActivity>;
export type InstallmentsActivity = InferOutput<typeof InstallmentsActivity>;
export type OnchainActivity = InferOutput<typeof OnchainActivity>;
export type PandaActivity = InferOutput<typeof PandaActivity>;
export type RepayActivity = InferOutput<typeof RepayActivity>;
export type WithdrawActivity = InferOutput<typeof WithdrawActivity>;
