import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import {
  exaPluginAbi,
  exaPluginAddress,
  exaPreviewerAbi,
  exaPreviewerAddress,
  upgradeableModularAccountAbi,
  usdcAddress,
} from "@exactly/common/generated/chain";
import { Address, type Hash, type Hex } from "@exactly/common/validation";
import { MATURITY_INTERVAL, splitInstallments } from "@exactly/lib";
import { vValidator } from "@hono/valibot-validator";
import {
  captureException,
  getActiveSpan,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  setContext,
  setTag,
  setUser,
  startSpan,
} from "@sentry/node";
import { E_TIMEOUT } from "async-mutex";
import createDebug from "debug";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { UnofficialStatusCode } from "hono/utils/http-status";
import * as v from "valibot";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  getContractError,
  keccak256,
  maxUint256,
  padHex,
  RawContractError,
  toBytes,
} from "viem";

import database, { cards, credentials, transactions } from "../database/index";
import {
  auditorAbi,
  issuerCheckerAbi,
  marketAbi,
  proposalManagerAbi,
  refunderAbi,
  refunderAddress,
} from "../generated/contracts";
import keeper from "../utils/keeper";
import { sendPushNotification } from "../utils/onesignal";
import { collectors, createMutex, getMutex, headerValidator, signIssuerOp } from "../utils/panda";
import publicClient from "../utils/publicClient";
import { track } from "../utils/segment";
import traceClient, { type CallFrame } from "../utils/traceClient";

const debug = createDebug("exa:panda");
Object.assign(debug, { inspectOpts: { depth: undefined } });

const BaseTransaction = v.object({
  id: v.string(),
  type: v.literal("spend"),
  spend: v.object({
    amount: v.number(),
    currency: v.literal("usd"),
    cardId: v.string(),
    cardType: v.literal("virtual"),
    localAmount: v.number(),
    localCurrency: v.pipe(v.string(), v.length(3)),
    merchantCity: v.nullish(v.string()),
    merchantCountry: v.nullish(v.string()),
    merchantName: v.string(),
  }),
});

const Transaction = v.variant("action", [
  v.object({
    resource: v.literal("transaction"),
    action: v.literal("created"),
    body: v.object({
      ...BaseTransaction.entries,
      spend: v.object({ ...BaseTransaction.entries.spend.entries, status: v.picklist(["pending", "declined"]) }),
    }),
  }),
  v.object({
    resource: v.literal("transaction"),
    action: v.literal("updated"),
    body: v.object({
      ...BaseTransaction.entries,
      spend: v.object({
        ...BaseTransaction.entries.spend.entries,
        authorizationUpdateAmount: v.number(),
        status: v.picklist(["declined", "pending", "reversed"]),
      }),
    }),
  }),
  v.object({
    resource: v.literal("transaction"),
    action: v.literal("requested"),
    body: v.object({
      ...BaseTransaction.entries,
      id: v.optional(v.string()),
      spend: v.object({ ...BaseTransaction.entries.spend.entries, status: v.literal("pending") }),
    }),
  }),
  v.object({
    resource: v.literal("transaction"),
    action: v.literal("completed"),
    body: v.object({
      ...BaseTransaction.entries,
      spend: v.object({ ...BaseTransaction.entries.spend.entries, status: v.literal("completed") }),
    }),
  }),
]);

const Payload = v.variant("resource", [
  Transaction,
  v.object({
    resource: v.literal("card"),
    action: v.literal("updated"),
    body: v.object({
      expirationMonth: v.pipe(v.string(), v.minLength(1), v.maxLength(2)),
      expirationYear: v.pipe(v.string(), v.length(4)),
      id: v.string(),
      last4: v.pipe(v.string(), v.length(4)),
      limit: v.object({
        amount: v.number(),
        frequency: v.picklist([
          "per24HourPeriod",
          "per7DayPeriod",
          "per30DayPeriod",
          "perYearPeriod",
          "allTime",
          "perAuthorization",
        ]),
      }),
      status: v.picklist(["notActivated", "active", "locked", "canceled"]),
      tokenWallets: v.union([v.array(v.literal("Apple")), v.array(v.literal("Google Pay"))]),
      type: v.literal("virtual"),
      userId: v.string(),
    }),
  }),
  v.object({
    resource: v.literal("user"),
    action: v.literal("updated"),
    body: v.object({
      applicationReason: v.string(),
      applicationStatus: v.string(),
      firstName: v.string(),
      id: v.string(),
      isActive: v.boolean(),
      isTermsOfServiceAccepted: v.boolean(),
      lastName: v.string(),
    }),
    id: v.string(),
  }),
]);

export default new Hono().post(
  "/",
  headerValidator(),
  vValidator("json", Payload, (validation, c) => {
    if (debug.enabled) {
      c.req
        .text()
        .then(debug)
        .catch((error: unknown) => captureException(error));
    }
    if (!validation.success) {
      captureException(new Error("bad panda"), { contexts: { validation } });
      return c.json("bad request", 400);
    }
  }),
  async (c) => {
    const payload = c.req.valid("json");
    setTag("panda.resource", payload.resource);
    setTag("panda.action", payload.action);
    const jsonBody = await c.req.json(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    setContext("panda", jsonBody); // eslint-disable-line @typescript-eslint/no-unsafe-argument
    getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, `panda.${payload.resource}.${payload.action}`);

    if (payload.resource !== "transaction") {
      const user = await database.query.credentials.findFirst({
        columns: { account: true },
        where: and(eq(credentials.pandaId, payload.resource === "card" ? payload.body.userId : payload.body.id)),
      });
      if (user) setUser({ id: user.account });
      return c.json({});
    }

    setTag("panda.status", payload.body.spend.status);
    getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, `panda.tx.${payload.action}`);

    switch (payload.action) {
      case "requested": {
        if (payload.body.spend.amount < 0) return c.json({});
        const card = await findCardById(payload.body.spend.cardId);
        const account = v.parse(Address, card.credential.account);
        setUser({ id: account });
        const mutex = getMutex(account) ?? createMutex(account);
        try {
          await startSpan({ name: "acquire mutex", op: "panda.mutex" }, () => mutex.acquire());
        } catch (error: unknown) {
          if (error === E_TIMEOUT) {
            captureException(error, { level: "fatal" });
            return c.json({}, 554 as UnofficialStatusCode);
          }
          throw error;
        }
        setContext("mutex", { locked: mutex.isLocked() });
        try {
          const { amount, call, transaction } = await prepareCollection(card, payload);
          const authorize = () => {
            try {
              track({
                userId: account,
                event: "TransactionAuthorized",
                properties: { type: "panda", usdAmount: payload.body.spend.amount / 100 },
              });
            } catch (error: unknown) {
              captureException(error, { level: "error" });
            }
            return c.json({});
          };
          if (!transaction) return authorize();
          try {
            const trace = await startSpan({ name: "debug_traceCall", op: "tx.trace" }, () =>
              traceClient.traceCall({
                from: account,
                to: exaPreviewerAddress,
                data: transaction.data,
                stateOverride: [
                  {
                    address: exaPluginAddress,
                    stateDiff: [
                      {
                        slot: keccak256(
                          encodeAbiParameters(
                            [{ type: "address" }, { type: "bytes32" }],
                            [
                              exaPreviewerAddress,
                              keccak256(
                                encodeAbiParameters(
                                  [{ type: "bytes32" }, { type: "uint256" }],
                                  [keccak256(toBytes("KEEPER_ROLE")), 0n],
                                ),
                              ),
                            ],
                          ),
                        ),
                        value: encodeAbiParameters([{ type: "uint256" }], [1n]),
                      },
                    ],
                  },
                ],
              }),
            );
            setContext("tx", { call, trace });
            if (trace.output) {
              captureException(
                getContractError(new RawContractError({ data: trace.output }), {
                  abi: [
                    ...exaPluginAbi,
                    ...issuerCheckerAbi,
                    ...proposalManagerAbi,
                    ...upgradeableModularAccountAbi,
                    ...auditorAbi,
                    ...marketAbi,
                  ],
                  ...call,
                }),
                { contexts: { tx: { call, trace } } },
              );
              throw new PandaError("tx reverted", 550);
            }
            if (
              usdcTransfersToCollectors(trace).reduce(
                (total, { topics, data }) =>
                  total + decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics, data }).args.value,
                0n,
              ) !== amount
            ) {
              debug(`${payload.action}:${payload.body.spend.status}`, payload.body.id, "bad collection");
              captureException(new Error("bad collection"), { level: "warning", contexts: { tx: { call, trace } } });
              throw new PandaError("bad collection", 551);
            }
            return authorize();
          } catch (error: unknown) {
            if (error instanceof PandaError) throw error;
            captureException(error, { contexts: { tx: { call } } });
            throw new PandaError("unexpected error", 569);
          }
        } catch (error: unknown) {
          mutex.release();
          setContext("mutex", { locked: mutex.isLocked() });
          if (error instanceof PandaError) return c.json(error.message, error.statusCode as UnofficialStatusCode);
          captureException(error);
          return c.json({}, 569 as UnofficialStatusCode);
        }
      }
      case "completed":
        if (payload.body.spend.amount >= 0) return c.json({});
      // falls through
      case "updated":
        if (payload.body.spend.status === "reversed" || payload.body.spend.status === "completed") {
          getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "panda.tx.refund");
          const refundAmountUsd =
            (payload.body.spend.status === "reversed"
              ? -payload.body.spend.authorizationUpdateAmount
              : -payload.body.spend.amount) / 100;
          const refundAmount = BigInt(Math.round(refundAmountUsd * 1e6));
          const card = await database.query.cards.findFirst({
            columns: {},
            where: eq(cards.id, payload.body.spend.cardId),
            with: { credential: { columns: { account: true } } },
          });
          if (!card) throw new Error("card not found");
          const account = v.parse(Address, card.credential.account);
          setUser({ id: account });

          const tx = await database.query.transactions.findFirst({
            where: and(eq(transactions.id, payload.body.id), eq(transactions.cardId, payload.body.spend.cardId)),
          });
          if (tx) {
            const payloads = v.parse(v.object({ bodies: v.array(Transaction) }), tx.payload);
            const totalSpendUsd =
              payloads.bodies.reduce((accumulator, body) => {
                if (body.action === "created" && body.body.spend.status === "pending") {
                  return accumulator + body.body.spend.amount;
                }
                if (
                  body.action === "updated" &&
                  (body.body.spend.status === "pending" || body.body.spend.status === "reversed")
                ) {
                  return accumulator + body.body.spend.authorizationUpdateAmount;
                }
                return accumulator;
              }, 0) / 100;
            const totalSpend = BigInt(Math.round(totalSpendUsd * 1e6));
            if (refundAmount > totalSpend) return c.json("refund higher than spend", 552 as UnofficialStatusCode);
          } else if (payload.body.spend.status === "reversed") {
            return c.json("spending transaction not found", 553 as UnofficialStatusCode);
          }
          const timestamp = Math.floor(Date.now() / 1000); // TODO use payload timestamp when provided
          const signature = await signIssuerOp({ account, amount: -refundAmount, timestamp }); // TODO replace with payload signature
          try {
            await keeper.exaSend(
              { name: "exa.refund", op: "exa.refund", attributes: { account } },
              {
                address: v.parse(Address, refunderAddress),
                functionName: "refund",
                args: [account, refundAmount, timestamp, signature],
                abi: [
                  ...auditorAbi,
                  ...exaPluginAbi,
                  ...issuerCheckerAbi,
                  ...marketAbi,
                  ...refunderAbi,
                  ...upgradeableModularAccountAbi,
                ],
              },
              {
                async onHash(hash) {
                  await (tx
                    ? database
                        .update(transactions)
                        .set({
                          hashes: [...tx.hashes, hash],
                          payload: {
                            ...(tx.payload as object),
                            bodies: [...parseBodies(tx.payload), { ...jsonBody, createdAt: new Date().toISOString() }],
                          },
                        })
                        .where(
                          and(eq(transactions.id, payload.body.id), eq(transactions.cardId, payload.body.spend.cardId)),
                        )
                    : database.insert(transactions).values([
                        {
                          id: payload.body.id,
                          cardId: payload.body.spend.cardId,
                          hashes: [hash],
                          payload: {
                            bodies: [{ ...jsonBody, createdAt: new Date().toISOString() }],
                            type: "panda",
                            merchant: {
                              name: payload.body.spend.merchantName,
                              city: payload.body.spend.merchantCity,
                              country: payload.body.spend.merchantCountry,
                            },
                          },
                        },
                      ]));
                },
              },
            );
            try {
              track({
                userId: account,
                event: "TransactionRefund",
                properties: {
                  id: payload.body.id,
                  type: payload.body.spend.status === "reversed" ? "reversal" : "refund",
                  usdAmount: refundAmountUsd,
                },
              });
            } catch (error: unknown) {
              captureException(error, { level: "error" });
            }
            return c.json({});
          } catch (error: unknown) {
            captureException(error, { level: "fatal", contexts: {} });
            return c.json(error instanceof Error ? error.message : String(error), 569 as UnofficialStatusCode);
          }
        }
      // falls through
      case "created": {
        if (payload.body.spend.amount < 0) return c.json({});

        const card = await findCardById(payload.body.spend.cardId);
        const account = v.parse(Address, card.credential.account);
        setUser({ id: account });

        if (payload.body.spend.status === "declined") {
          getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "panda.tx.declined");
          const mutex = getMutex(account);
          mutex?.release();
          setContext("mutex", { locked: mutex?.isLocked() });
          return c.json({});
        }
        if (payload.body.spend.status !== "pending") return c.json({});
        getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "panda.tx.collect");
        try {
          const { call } = await prepareCollection(card, payload);
          if (!call) return c.json({});
          try {
            await keeper.exaSend(
              { name: "collect credit", op: "exa.collect", attributes: { account } },
              {
                address: account,
                abi: [
                  ...exaPluginAbi,
                  ...issuerCheckerAbi,
                  ...upgradeableModularAccountAbi,
                  ...auditorAbi,
                  ...marketAbi,
                ],
                ...call,
              },
              {
                async onHash(hash) {
                  const tx = await database.query.transactions.findFirst({
                    where: and(
                      eq(transactions.id, payload.body.id),
                      eq(transactions.cardId, payload.body.spend.cardId),
                    ),
                  });
                  await (tx
                    ? database
                        .update(transactions)
                        .set({
                          hashes: [...tx.hashes, hash],
                          payload: {
                            ...(tx.payload as object),
                            bodies: [...parseBodies(tx.payload), { ...jsonBody, createdAt: new Date().toISOString() }],
                          },
                        })
                        .where(
                          and(eq(transactions.id, payload.body.id), eq(transactions.cardId, payload.body.spend.cardId)),
                        )
                    : database.insert(transactions).values([
                        {
                          id: payload.body.id,
                          cardId: payload.body.spend.cardId,
                          hashes: [hash],
                          payload: {
                            bodies: [{ ...jsonBody, createdAt: new Date().toISOString() }],
                            type: "panda",
                            merchant: {
                              name: payload.body.spend.merchantName,
                              city: payload.body.spend.merchantCity,
                              country: payload.body.spend.merchantCountry,
                            },
                          },
                        },
                      ]));
                },
              },
            );
            sendPushNotification({
              userId: account,
              headings: { en: "Exa Card Purchase" },
              contents: {
                en: `${(payload.body.spend.localAmount / 100).toLocaleString(undefined, {
                  style: "currency",
                  currency: payload.body.spend.localCurrency,
                })} at ${payload.body.spend.merchantName.trim()}, paid in ${{ 0: "debit", 1: "credit" }[card.mode] ?? `${card.mode} installments`} with USDC`,
              },
            }).catch((error: unknown) => captureException(error, { level: "error" }));
            return c.json({});
          } catch (error: unknown) {
            captureException(error, { level: "fatal", contexts: { tx: { call } } });
            return c.text(error instanceof Error ? error.message : String(error), 569 as UnofficialStatusCode);
          }
        } finally {
          const mutex = getMutex(account);
          mutex?.release();
          setContext("mutex", { locked: mutex?.isLocked() });
        }
      }
      default:
        return c.json({});
    }
  },
);

async function prepareCollection(
  card: { mode: number; credential: { account: string } },
  payload: v.InferOutput<typeof Transaction>,
) {
  const account = v.parse(Address, card.credential.account);
  setTag("exa.mode", card.mode);
  const usdAmount =
    (payload.action === "updated" ? payload.body.spend.authorizationUpdateAmount : payload.body.spend.amount) / 100;
  const amount = BigInt(Math.round(usdAmount * 1e6));
  if (amount === 0n) return { amount, call: null, transaction: null };
  const call = await (async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await signIssuerOp({ account, amount, timestamp }); // TODO replace with payload signature
    if (card.mode === 0) {
      return { functionName: "collectDebit", args: [amount, BigInt(timestamp), signature] } as const;
    }
    const nextMaturity = timestamp - (timestamp % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    const firstMaturity =
      nextMaturity - timestamp < MIN_BORROW_INTERVAL ? nextMaturity + MATURITY_INTERVAL : nextMaturity;
    if (card.mode === 1 || usdAmount < card.mode || payload.action === "requested") {
      return {
        functionName: "collectCredit",
        args: [
          BigInt(firstMaturity + (card.mode - 1) * MATURITY_INTERVAL),
          amount,
          maxUint256,
          BigInt(timestamp),
          signature,
        ],
      } as const;
    }
    const preview = await startSpan({ name: "query onchain state", op: "exa.preview" }, () =>
      publicClient.readContract({
        abi: exaPreviewerAbi,
        address: exaPreviewerAddress,
        functionName: "utilizations",
      }),
    );
    setContext("preview", preview);
    const installments = startSpan({ name: "split installments", op: "exa.split" }, () =>
      splitInstallments(
        amount,
        preview.floatingAssets,
        firstMaturity,
        preview.fixedUtilizations.length,
        preview.fixedUtilizations
          .filter(
            ({ maturity }) => maturity >= firstMaturity && maturity < firstMaturity + card.mode * MATURITY_INTERVAL,
          )
          .map(({ utilization }) => utilization),
        preview.floatingUtilization,
        preview.globalUtilization,
        preview.interestRateModel,
      ),
    );
    setContext("installments", installments);
    return {
      functionName: "collectInstallments",
      args: [BigInt(firstMaturity), installments.amounts, maxUint256, BigInt(timestamp), signature],
    } as const;
  })();
  setContext("tx", { call });
  return {
    amount,
    call,
    transaction: {
      from: keeper.account.address,
      to: account,
      data: encodeFunctionData({ abi: exaPluginAbi, ...call }),
    } as const,
  };
}

const collectorTopics = new Set(collectors.map((address) => padHex(address.toLowerCase() as Hex)));
const [transferTopic] = encodeEventTopics({ abi: erc20Abi, eventName: "Transfer" });
const usdcLowercase = usdcAddress.toLowerCase() as Hex;
function usdcTransfersToCollectors({ calls, logs }: CallFrame): TransferLog[] {
  return [
    ...(logs?.filter(
      (log): log is TransferLog =>
        log.address === usdcLowercase &&
        log.topics?.[0] === transferTopic &&
        log.topics[2] !== undefined &&
        collectorTopics.has(log.topics[2]),
    ) ?? []),
    ...(calls?.flatMap(usdcTransfersToCollectors) ?? []),
  ];
}

interface TransferLog {
  address: Hex;
  topics: [Hash, Hash, Hash];
  data: Hex;
  position: Hex;
}

class PandaError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "PandaError";
  }
}

function parseBodies(raw: unknown) {
  const payload = v.safeParse(
    v.object({
      bodies: v.array(v.looseObject({})),
    }),
    raw,
  );
  if (!payload.success) throw new Error("invalid transaction payload");
  return payload.output.bodies;
}

async function findCardById(cardId: string) {
  const card = await database.query.cards.findFirst({
    columns: { mode: true },
    where: and(eq(cards.id, cardId), eq(cards.status, "ACTIVE")),
    with: { credential: { columns: { account: true } } },
  });
  if (!card) throw new Error("card not found");
  return card;
}
