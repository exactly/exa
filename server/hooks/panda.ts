import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import { exaPluginAddress, exaPreviewerAddress, usdcAddress } from "@exactly/common/generated/chain";
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
  BaseError,
  ContractFunctionRevertedError,
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
  zeroHash,
} from "viem";

import database, { cards, credentials, transactions } from "../database/index";
import {
  auditorAbi,
  exaPluginAbi,
  exaPreviewerAbi,
  issuerCheckerAbi,
  marketAbi,
  proposalManagerAbi,
  refunderAbi,
  refunderAddress,
  upgradeableModularAccountAbi,
} from "../generated/contracts";
import keeper from "../utils/keeper";
import { sendPushNotification } from "../utils/onesignal";
import { collectors, createMutex, getMutex, getUser, headerValidator, signIssuerOp, updateUser } from "../utils/panda";
import publicClient from "../utils/publicClient";
import { track } from "../utils/segment";
import traceClient, { type CallFrame } from "../utils/traceClient";
import validatorHook from "../utils/validatorHook";

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
    merchantCategory: v.nullish(v.string()),
    merchantName: v.string(),
    authorizedAt: v.optional(v.pipe(v.string(), v.isoTimestamp())),
    authorizedAmount: v.nullish(v.number()),
    userId: v.string(),
  }),
});

const Transaction = v.variant("action", [
  v.object({
    id: v.string(),
    resource: v.literal("transaction"),
    action: v.literal("created"),
    body: v.object({
      ...BaseTransaction.entries,
      spend: v.object({
        ...BaseTransaction.entries.spend.entries,
        status: v.picklist(["pending", "declined"]),
        declinedReason: v.nullish(v.string()),
      }),
    }),
  }),
  v.object({
    id: v.string(),
    resource: v.literal("transaction"),
    action: v.literal("updated"),
    body: v.object({
      ...BaseTransaction.entries,
      spend: v.object({
        ...BaseTransaction.entries.spend.entries,
        authorizationUpdateAmount: v.number(),
        authorizedAt: v.pipe(v.string(), v.isoTimestamp()),
        status: v.picklist(["declined", "pending", "reversed"]),
        declinedReason: v.nullish(v.string()),
      }),
    }),
  }),
  v.object({
    id: v.string(),
    resource: v.literal("transaction"),
    action: v.literal("requested"),
    body: v.object({
      ...BaseTransaction.entries,
      id: v.optional(v.string()),
      spend: v.object({
        ...BaseTransaction.entries.spend.entries,
        authorizedAmount: v.number(),
        status: v.literal("pending"),
      }),
    }),
  }),
  v.object({
    id: v.string(),
    resource: v.literal("transaction"),
    action: v.literal("completed"),
    body: v.object({
      ...BaseTransaction.entries,
      spend: v.object({
        ...BaseTransaction.entries.spend.entries,
        authorizedAt: v.pipe(v.string(), v.isoTimestamp()),
        postedAt: v.pipe(v.string(), v.isoTimestamp()),
        status: v.literal("completed"),
      }),
    }),
  }),
]);

const Payload = v.variant("resource", [
  Transaction,
  v.object({
    id: v.string(),
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
  vValidator("json", Payload, validatorHook({ code: "bad panda", status: 400, debug })),
  async (c) => {
    const payload = c.req.valid("json");
    getActiveSpan()?.setAttributes({ "panda.event": payload.id, "panda.transaction": payload.body.id });
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
      return c.json({ code: "ok" });
    }

    setTag("panda.status", payload.body.spend.status);
    getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, `panda.tx.${payload.action}`);

    switch (payload.action) {
      case "requested": {
        if (payload.body.spend.amount < 0) return c.json({ code: "ok" });
        const card = await findCardById(payload.body.spend.cardId);
        const account = v.parse(Address, card.credential.account);
        setUser({ id: account });
        const mutex = getMutex(account) ?? createMutex(account);
        try {
          await startSpan({ name: "acquire mutex", op: "panda.mutex" }, () => mutex.acquire());
        } catch (error: unknown) {
          if (error === E_TIMEOUT) {
            captureException(error, { level: "fatal", tags: { unhandled: true } });
            trackAuthorizationRejected(account, payload, card.mode, "mutex-timeout");
            return c.json({ code: "mutex timeout" }, 554 as UnofficialStatusCode);
          }
          trackAuthorizationRejected(account, payload, card.mode, "unknown-error");
          throw error;
        }
        setContext("mutex", { locked: mutex.isLocked() });
        try {
          const { amount, call, transaction } = await prepareCollection(card, payload);
          const authorize = () => {
            trackTransactionAuthorized(account, payload, card.mode);
            return c.json({ code: "ok" });
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
              const contractError = getContractError(new RawContractError({ data: trace.output }), {
                abi: [
                  ...exaPluginAbi,
                  ...issuerCheckerAbi,
                  ...proposalManagerAbi,
                  ...upgradeableModularAccountAbi,
                  ...auditorAbi,
                  ...marketAbi,
                ],
                ...call,
              });
              trackAuthorizationRejected(account, payload, card.mode, contractError.shortMessage);
              captureException(contractError, { contexts: { tx: { call, trace } } });
              if (
                contractError instanceof BaseError &&
                contractError.cause instanceof ContractFunctionRevertedError &&
                contractError.cause.data?.errorName === "InsufficientAccountLiquidity"
              ) {
                throw new PandaError("InsufficientAccountLiquidity", 557 as UnofficialStatusCode);
              }
              throw new PandaError("tx reverted", 550 as UnofficialStatusCode);
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
              throw new PandaError("bad collection", 551 as UnofficialStatusCode);
            }
            return authorize();
          } catch (error: unknown) {
            if (error instanceof PandaError) throw error;
            captureException(error, { contexts: { tx: { call } } });
            throw new PandaError("unexpected error", 569 as UnofficialStatusCode);
          }
        } catch (error: unknown) {
          mutex.release();
          setContext("mutex", { locked: mutex.isLocked() });
          if (error instanceof PandaError) {
            error.message !== "tx reverted" && trackAuthorizationRejected(account, payload, card.mode, "panda-error");
            captureException(error, { level: "error", tags: { unhandled: true } });
            return c.json({ code: error.message }, error.statusCode as UnofficialStatusCode);
          }
          trackAuthorizationRejected(account, payload, card.mode, "unexpected-error");
          captureException(error, { level: "error", tags: { unhandled: true } });
          return c.json({ code: "ouch" }, 569 as UnofficialStatusCode);
        }
      }
      case "completed":
      // falls through
      case "updated":
        if (
          payload.body.spend.status === "reversed" ||
          (payload.body.spend.status === "completed" &&
            (payload.body.spend.amount < 0 ||
              (payload.body.spend.authorizedAmount && payload.body.spend.amount < payload.body.spend.authorizedAmount)))
        ) {
          getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "panda.tx.refund");
          const refundAmountUsd =
            (() => {
              if (payload.body.spend.status === "reversed") return -payload.body.spend.authorizationUpdateAmount;
              if (payload.body.spend.amount < 0) return -payload.body.spend.amount;
              if (!payload.body.spend.authorizedAmount) throw new Error("authorized amount not found");
              getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "panda.tx.capture.partial");
              return payload.body.spend.authorizedAmount - payload.body.spend.amount;
            })() / 100;
          const refundAmount = BigInt(Math.round(refundAmountUsd * 1e6));
          const [card, user] = await Promise.all([
            database.query.cards.findFirst({
              columns: {},
              where: eq(cards.id, payload.body.spend.cardId),
              with: { credential: { columns: { account: true } } },
            }),
            getUser(payload.body.spend.userId),
          ]);
          if (!user.isActive) throw new Error("user is not active");
          if (!card) throw new Error("card not found");
          const account = v.parse(Address, card.credential.account);
          setUser({ id: account });

          const tx = await database.query.transactions.findFirst({
            where: and(eq(transactions.id, payload.body.id), eq(transactions.cardId, payload.body.spend.cardId)),
          });
          if (!tx && payload.body.spend.status === "reversed") {
            return c.json({ code: "transaction not found" }, 553 as UnofficialStatusCode);
          }
          const timestamp = // TODO use update timestamp when provided
            Math.floor(new Date(payload.body.spend.authorizedAt).getTime() / 1000) -
            Number(BigInt(`0x${payload.id.replaceAll(/[^0-9a-f]/g, "")}`) % 3600n);
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
                  const createdAt = getCreatedAt(payload) ?? new Date().toISOString();
                  await (tx
                    ? database
                        .update(transactions)
                        .set({
                          hashes: [...tx.hashes, hash],
                          payload: {
                            ...(tx.payload as object),
                            bodies: [...v.parse(TransactionPayload, tx.payload).bodies, { ...jsonBody, createdAt }],
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
                            bodies: [{ ...jsonBody, createdAt }],
                            type: "panda",
                          },
                        },
                      ]));
                },
              },
            );
            sendPushNotification({
              userId: account,
              headings: { en: "Refund processed" },
              contents: {
                en: `${refundAmountUsd} USDC from ${payload.body.spend.merchantName.trim()} have been refunded to your account`,
              },
            }).catch((error: unknown) => captureException(error));
            trackTransactionRefund(account, refundAmountUsd, payload);
            return c.json({ code: "ok" });
          } catch (error: unknown) {
            captureException(error, { level: "fatal", tags: { unhandled: true } });
            return c.json(
              { code: error instanceof Error ? error.message : String(error) },
              569 as UnofficialStatusCode,
            );
          }
        }
      // falls through
      case "created": {
        if (payload.body.spend.amount < 0) return c.json({ code: "ok" });

        const card = await findCardById(payload.body.spend.cardId);
        const account = v.parse(Address, card.credential.account);
        setUser({ id: account });

        if (payload.body.spend.status === "declined") {
          getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "panda.tx.declined");
          const mutex = getMutex(account);
          mutex?.release();
          setContext("mutex", { locked: mutex?.isLocked() });
          trackTransactionRejected(account, payload, card.mode);
          return c.json({ code: "ok" });
        }
        if (payload.body.spend.status !== "pending" && payload.action !== "completed") return c.json({ code: "ok" });
        getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "panda.tx.collect");

        try {
          const { call } = await prepareCollection(card, payload);
          if (!call) {
            const tx = await database.query.transactions.findFirst({
              where: and(eq(transactions.id, payload.body.id), eq(transactions.cardId, payload.body.spend.cardId)),
            });
            if (!tx) throw new Error("transaction not found");
            await database
              .update(transactions)
              .set({
                hashes: [...tx.hashes, zeroHash],
                payload: {
                  ...(tx.payload as object),
                  bodies: [
                    ...v.parse(TransactionPayload, tx.payload).bodies,
                    { ...jsonBody, createdAt: new Date().toISOString() },
                  ],
                },
              })
              .where(and(eq(transactions.id, payload.body.id), eq(transactions.cardId, payload.body.spend.cardId)));

            return c.json({ code: "ok" });
          }
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
                  const createdAt = getCreatedAt(payload) ?? new Date().toISOString();
                  await (tx
                    ? database
                        .update(transactions)
                        .set({
                          hashes: [...tx.hashes, hash],
                          payload: {
                            ...(tx.payload as object),
                            bodies: [...v.parse(TransactionPayload, tx.payload).bodies, { ...jsonBody, createdAt }],
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
                            bodies: [{ ...jsonBody, createdAt }],
                            type: "panda",
                          },
                        },
                      ]));
                },
              },
            );

            if (
              payload.action === "created" ||
              (payload.action === "completed" && payload.body.spend.amount > 0 && !payload.body.spend.authorizedAmount) // force capture
            ) {
              sendPushNotification({
                userId: account,
                headings: { en: "Card purchase" },
                contents: {
                  en: `${(payload.body.spend.localAmount / 100).toLocaleString(undefined, {
                    style: "currency",
                    currency: payload.body.spend.localCurrency,
                  })} at ${payload.body.spend.merchantName.trim()}. Paid ${{ 0: "with USDC", 1: "with credit" }[card.mode] ?? `in ${card.mode} installments`}`,
                },
              }).catch((error: unknown) => captureException(error, { level: "error" }));
            }
            return c.json({ code: "ok" });
          } catch (error: unknown) {
            captureException(error, { level: "fatal", contexts: { tx: { call } } });
            if (payload.action === "completed") {
              const tx = await database.query.transactions.findFirst({
                where: and(eq(transactions.id, payload.body.id), eq(transactions.cardId, payload.body.spend.cardId)),
              });
              if (!tx || !v.parse(TransactionPayload, tx.payload).bodies.some((t) => t.action === "created")) {
                await updateUser({ id: payload.body.spend.userId, isActive: false });
                getActiveSpan()?.setAttributes({ "panda.suspicious": true, "panda.amount": payload.body.spend.amount });
                return c.text(error instanceof Error ? error.message : String(error), 556 as UnofficialStatusCode);
              }
            }
            return c.text(error instanceof Error ? error.message : String(error), 569 as UnofficialStatusCode);
          }
        } finally {
          const mutex = getMutex(account);
          if (payload.action === "created" || payload.action === "updated") mutex?.release();
          setContext("mutex", { locked: mutex?.isLocked() });
        }
      }
      default:
        return c.json({ code: "ok" });
    }
  },
);

function trackTransactionAuthorized(
  account: Address,
  payload: v.InferOutput<typeof Transaction>,
  cardMode: number,
): void {
  track({
    userId: account,
    event: "TransactionAuthorized",
    properties: {
      type: "panda",
      cardMode,
      usdAmount: payload.body.spend.amount / 100,
      merchant: {
        name: payload.body.spend.merchantName,
        category: payload.body.spend.merchantCategory,
        city: payload.body.spend.merchantCity,
        country: payload.body.spend.merchantCountry,
      },
    },
  });
}

function trackAuthorizationRejected(
  account: Address,
  payload: v.InferOutput<typeof Transaction>,
  cardMode: number,
  declinedReason: string,
): void {
  track({
    userId: account,
    event: "AuthorizationRejected",
    properties: {
      cardMode,
      usdAmount: payload.body.spend.amount / 100,
      declinedReason,
      merchant: {
        name: payload.body.spend.merchantName,
        category: payload.body.spend.merchantCategory,
        city: payload.body.spend.merchantCity,
        country: payload.body.spend.merchantCountry,
      },
    },
  });
}

function trackTransactionRejected(
  account: Address,
  payload: v.InferOutput<typeof Transaction>,
  cardMode: number,
): void {
  if (payload.action !== "created" && payload.action !== "updated") {
    captureException(new Error("unsupported transaction type"), { contexts: { payload } });
    return;
  }
  track({
    userId: account,
    event: "TransactionRejected",
    properties: {
      id: payload.body.id,
      cardMode,
      usdAmount: payload.body.spend.amount / 100,
      merchant: {
        name: payload.body.spend.merchantName,
        category: payload.body.spend.merchantCategory,
        city: payload.body.spend.merchantCity,
        country: payload.body.spend.merchantCountry,
      },
      updated: payload.action === "updated",
      declinedReason: payload.body.spend.declinedReason,
    },
  });
}

function trackTransactionRefund(
  account: Address,
  refundAmountUsd: number,
  payload: v.InferOutput<typeof Transaction>,
): void {
  if (payload.action === "requested") {
    captureException(new Error("unsupported transaction type"), { contexts: { payload } });
    return;
  }
  track({
    userId: account,
    event: "TransactionRefund",
    properties: {
      id: payload.body.id,
      type:
        payload.body.spend.status === "reversed" ? "reversal" : payload.body.spend.amount < 0 ? "refund" : "partial",
      usdAmount: refundAmountUsd,
      merchant: {
        name: payload.body.spend.merchantName,
        category: payload.body.spend.merchantCategory,
        city: payload.body.spend.merchantCity,
        country: payload.body.spend.merchantCountry,
      },
    },
  });
}

function getCreatedAt(payload: v.InferOutput<typeof Transaction>): string | undefined {
  switch (payload.action) {
    case "completed":
      return payload.body.spend.postedAt;
    case "created":
    case "updated":
      return payload.body.spend.authorizedAt;
    default:
      return undefined;
  }
}

async function prepareCollection(
  card: { mode: number; credential: { account: string } },
  payload: v.InferOutput<typeof Transaction>,
) {
  const account = v.parse(Address, card.credential.account);
  setTag("exa.mode", card.mode);
  const usdAmount =
    (await (async () => {
      switch (payload.action) {
        case "updated":
          return payload.body.spend.authorizationUpdateAmount;
        case "completed": {
          const tx = await database.query.transactions.findFirst({
            columns: { payload: true },
            where: and(eq(transactions.id, payload.body.id), eq(transactions.cardId, payload.body.spend.cardId)),
          });
          if (!tx || !v.parse(TransactionPayload, tx.payload).bodies.some((t) => t.action === "created")) {
            getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "panda.tx.capture.force");
            return payload.body.spend.amount;
          }
          getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "panda.tx.capture.settlement");
          const capture = payload.body.spend.amount - (payload.body.spend.authorizedAmount ?? 0);
          if (capture > 0) getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "panda.tx.capture.over");
          return capture;
        }
        case "created":
        case "requested":
          return payload.body.spend.amount;
        default:
          throw new Error("unexpected action");
      }
    })()) / 100;
  const amount = BigInt(Math.round(usdAmount * 1e6));
  if (amount === 0n) return { amount, call: null, transaction: null };
  const call = await (async () => {
    const timestamp = Math.floor(
      (payload.body.spend.authorizedAt ? new Date(payload.body.spend.authorizedAt) : new Date()).getTime() / 1000, // TODO remove fallback
    );
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

const TransactionPayload = v.object(
  { bodies: v.array(v.looseObject({ action: v.string() }), "invalid transaction payload") },
  "invalid transaction payload",
);

async function findCardById(cardId: string) {
  const card = await database.query.cards.findFirst({
    columns: { mode: true },
    where: and(eq(cards.id, cardId), eq(cards.status, "ACTIVE")),
    with: { credential: { columns: { account: true } } },
  });
  if (!card) throw new Error("card not found");
  return card;
}
