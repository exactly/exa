import { vValidator } from "@hono/valibot-validator";
import {
  captureException,
  getActiveSpan,
  SEMANTIC_ATTRIBUTE_SENTRY_OP,
  setContext,
  setTag,
  setUser,
  startSpan,
  withScope,
} from "@sentry/node";
import { E_TIMEOUT } from "async-mutex";
import createDebug from "debug";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
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
  type LocalAccount,
} from "viem";

import {
  auditorAbi,
  exaPluginAbi,
  exaPluginAddress,
  exaPreviewerAbi,
  exaPreviewerAddress,
  issuerCheckerAbi,
  marketAbi,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
  usdcAddress,
} from "@exactly/common/generated/chain";
import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import revertReason from "@exactly/common/revertReason";
import { Address, type Hash, type Hex } from "@exactly/common/validation";
import { MATURITY_INTERVAL, splitInstallments } from "@exactly/lib";

import { cards, credentials, transactions } from "../database/schema";
import t, { f } from "../i18n";
import {
  collectors,
  createMutex,
  declineMessage,
  getMutex,
  Payload,
  signIssuerOp,
  TransactionPayload,
  type Transaction,
} from "../utils/panda";
import publicClient from "../utils/publicClient";
import revertFingerprint from "../utils/revertFingerprint";
import traceClient, { type CallFrame } from "../utils/traceClient";
import validatorHook from "../utils/validatorHook";
import createWallet from "../utils/wallet";
import { name as hookName } from "../workers/hook/job";
import { name as refundName } from "../workers/refund/job";

import type * as schema from "../database/schema";
import type createOnesignal from "../utils/onesignal";
import type createPanda from "../utils/panda";
import type createSardine from "../utils/sardine";
import type createSegment from "../utils/segment";
import type createHook from "../workers/hook/queue";
import type createRefund from "../workers/refund/queue";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { UnofficialStatusCode } from "hono/utils/http-status";

const debug = createDebug("exa:panda");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default function hook({
  database,
  issuer,
  onesignal,
  panda,
  refund,
  sardine,
  segment,
  settler,
  webhook,
}: {
  database: Database;
  issuer: LocalAccount;
  onesignal: ReturnType<typeof createOnesignal>;
  panda: ReturnType<typeof createPanda>;
  refund: ReturnType<typeof createRefund>;
  sardine: ReturnType<typeof createSardine>;
  segment: ReturnType<typeof createSegment>;
  settler: LocalAccount;
  webhook: ReturnType<typeof createHook>;
}) {
  const wallet = createWallet(settler);
  const app = new Hono().post(
    "/",
    panda.headerValidator,
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
        if (payload.resource === "dispute") return c.json({ code: "ok" });
        const pandaId =
          payload.resource === "card"
            ? payload.action === "updated"
              ? payload.body.userId
              : payload.body.card.userId
            : payload.body.id;
        if (pandaId) {
          const user = await database.query.credentials.findFirst({
            columns: { account: true },
            where: eq(credentials.pandaId, pandaId),
          });
          if (user) setUser({ id: user.account });
          if (payload.resource !== "card" || payload.action !== "notification") {
            webhook.enqueue({}, payload.id).catch((error: unknown) =>
              captureException(error, {
                level: "error",
                tags: { queue: hookName, job: hookName },
                extra: { id: payload.id },
              }),
            );
          }
        }
        return c.json({ code: "ok" });
      }

      setTag("panda.status", payload.body.spend.status);
      getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, `panda.tx.${payload.action}`);

      switch (payload.action) {
        case "requested": {
          const card = await database.query.cards.findFirst({
            columns: { mode: true, status: true },
            where: eq(cards.id, payload.body.spend.cardId),
            with: { credential: { columns: { account: true, id: true, source: true } } },
          });
          if (!card) {
            return c.json({ code: "card not found", rejectionCode: "UNKNOWN" }, 404);
          }

          const account = v.parse(Address, card.credential.account);
          setUser({ id: account });

          if (card.status === "FROZEN") {
            trackAuthorizationRejected(account, payload, card.mode, card.credential.source, "frozen-card", segment);

            await reject(payload, jsonBody, "frozenCard", database);

            return c.json({ code: "frozen card", rejectionCode: "NOT_PERMITTED" }, 403 as UnofficialStatusCode);
          }

          if (card.status !== "ACTIVE") {
            trackAuthorizationRejected(account, payload, card.mode, card.credential.source, "card-not-active", segment);
            return c.json({ code: "card not active", rejectionCode: "NOT_PERMITTED" }, 403);
          }
          const assess = async () => {
            try {
              return await sardine.risk({
                sessionKey: payload.body.id ?? payload.id,
                customerId: card.credential.id,
                transaction: {
                  id: payload.body.id ?? payload.id,
                  currencyCode: payload.body.spend.localCurrency,
                  amount: Math.abs(payload.body.spend.localAmount) / 100,
                  type: payload.body.spend.amount < 0 ? "return" : "purchase",
                  merchant: {
                    mcc: payload.body.spend.merchantCategoryCode,
                    name: payload.body.spend.merchantName,
                    ...(payload.body.spend.merchantId && { id: payload.body.spend.merchantId }),
                  },
                  terminal: { type: payload.body.spend.authorizationMethod },
                  address: { countryCode: payload.body.spend.merchantCountry },
                  status: "pending",
                },
                card: { id: payload.body.spend.cardId },
              });
            } catch (error) {
              captureException(error, { level: "error" });
              return {
                status: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "error",
                level: "unknown",
                score: 0,
              };
            }
          };

          if (payload.body.spend.amount < 0) {
            startSpan({ name: "assess risk", op: "tx.risk.refund" }, async (span) => {
              const assessment = await assess();
              span.setAttributes({ "exa.level": assessment.level, "exa.score": assessment.score });
              if (assessment.level === "high" || assessment.level === "very_high") {
                captureException(new Error("high risk refund"), { level: "error" });
              }
            }).catch((error: unknown) => captureException(error, { level: "error" }));
            return c.json({ code: "ok" });
          }
          const mutex = getMutex(account) ?? createMutex(account);
          try {
            await startSpan({ name: "acquire mutex", op: "panda.mutex" }, () => mutex.acquire());
          } catch (error: unknown) {
            if (error === E_TIMEOUT) {
              captureException(error, { level: "fatal", tags: { unhandled: true } });
              trackAuthorizationRejected(account, payload, card.mode, card.credential.source, "mutex-timeout", segment);
              return c.json({ code: "mutex timeout", rejectionCode: "UNKNOWN" }, 554 as UnofficialStatusCode);
            }
            trackAuthorizationRejected(account, payload, card.mode, card.credential.source, "unknown-error", segment);
            throw error;
          }
          setContext("mutex", { locked: mutex.isLocked() });

          try {
            const { amount, call, transaction } = await prepareCollection(
              card,
              payload,
              database,
              issuer,
              panda,
              wallet,
            );
            const authorize = () => {
              trackAuthorized(account, payload, card.mode, card.credential.source, segment);
              return c.json({ code: "ok" });
            };
            if (!transaction) {
              startSpan({ name: "assess risk", op: "tx.risk.verification" }, async (span) => {
                const assessment = await assess();
                span.setAttributes({ "exa.level": assessment.level, "exa.score": assessment.score });
                if (assessment.level === "high" || assessment.level === "very_high") {
                  captureException(new Error("high risk verification"), { level: "error" });
                }
              }).catch((error: unknown) => captureException(error, { level: "error" }));
              return authorize();
            }

            startSpan({ name: "assess risk", op: "tx.risk.authorization" }, async (span) => {
              const assessment = await assess();
              span.setAttributes({ "exa.level": assessment.level, "exa.score": assessment.score });
              if (assessment.level === "high" || assessment.level === "very_high") {
                captureException(new Error("high risk authorization"), { level: "error" });
              }
            }).catch((error: unknown) => captureException(error, { level: "error" }));
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
                trackAuthorizationRejected(
                  account,
                  payload,
                  card.mode,
                  card.credential.source,
                  contractError.shortMessage,
                  segment,
                );
                if (
                  contractError instanceof BaseError &&
                  contractError.cause instanceof ContractFunctionRevertedError
                ) {
                  switch (contractError.cause.data?.errorName) {
                    case "InsufficientAccountLiquidity":
                      throw new PandaError(
                        "InsufficientAccountLiquidity",
                        557 as UnofficialStatusCode,
                        "INSUFFICIENT_FUNDS",
                      );
                    case "Replay":
                      throw new PandaError("Replay", 558 as UnofficialStatusCode);
                  }
                }
                captureException(contractError, {
                  contexts: { tx: { call, trace } },
                  fingerprint: revertFingerprint(contractError),
                });
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
                withScope((scope) => {
                  scope.addEventProcessor((event) => {
                    if (event.exception?.values?.[0]) event.exception.values[0].type = "bad collection";
                    return event;
                  });
                  captureException(new Error("bad collection"), {
                    level: "warning",
                    fingerprint: ["{{ default }}", "bad collection"],
                    contexts: { tx: { call, trace } },
                  });
                });
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
              error.message !== "tx reverted" &&
                trackAuthorizationRejected(account, payload, card.mode, card.credential.source, "panda-error", segment);
              if (error.statusCode !== (557 as UnofficialStatusCode)) {
                captureException(error, { level: "error", tags: { unhandled: true } });
              }

              if (error.message !== "Replay" && error.message !== "tx reverted") {
                await reject(payload, jsonBody, error.message, database);
              }

              return c.json(
                { code: error.message, rejectionCode: error.rejectionCode },
                error.statusCode as UnofficialStatusCode,
              );
            }
            trackAuthorizationRejected(
              account,
              payload,
              card.mode,
              card.credential.source,
              "unexpected-error",
              segment,
            );
            captureException(error, { level: "error", tags: { unhandled: true } });

            await reject(payload, jsonBody, error instanceof Error ? error.message : "unexpected error", database);

            return c.json({ code: "ouch", rejectionCode: "UNKNOWN" }, 569 as UnofficialStatusCode);
          }
        }
        case "completed":
        // falls through
        case "updated":
          if (
            payload.body.spend.status === "reversed" ||
            (payload.body.spend.status === "completed" &&
              (payload.body.spend.amount < 0 ||
                (payload.body.spend.authorizedAmount &&
                  payload.body.spend.amount < payload.body.spend.authorizedAmount)))
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
            const refundAmount = Math.round(refundAmountUsd * 1e6);
            const card = await database.query.cards.findFirst({
              columns: { mode: true },
              where: eq(cards.id, payload.body.spend.cardId),
              with: { credential: { columns: { account: true } } },
            });
            if (!card) throw new Error("card not found");
            const account = v.parse(Address, card.credential.account);
            setUser({ id: account });
            if (
              payload.body.spend.status === "reversed" &&
              !(await database.query.transactions.findFirst({
                columns: { id: true },
                where: and(eq(transactions.id, payload.body.id), eq(transactions.cardId, payload.body.spend.cardId)),
              }))
            ) {
              return c.json({ code: "transaction not found" }, 553 as UnofficialStatusCode);
            }
            const timestamp = // TODO use update timestamp when provided
              Math.floor(new Date(payload.body.spend.authorizedAt).getTime() / 1000) -
              Number(BigInt(`0x${payload.id.replaceAll(/[^0-9a-f]/g, "")}`) % 3600n);

            if (payload.body.spend.signature) {
              await startSpan(
                {
                  name: "panda.signature",
                  op: "panda.signature",
                  attributes: {
                    "signature.account": account,
                    "signature.amount": String(-refundAmount),
                    "signature.timestamp": String(payload.body.spend.timestamp ?? 0),
                  },
                },
                async (span) => {
                  if (!payload.body.spend.signature) throw new Error("signature not found");
                  if (!payload.body.spend.timestamp) throw new Error("timestamp not found");
                  const valid = await panda.verifyPandaSignature(
                    {
                      account,
                      amount: -BigInt(refundAmount),
                      timestamp: payload.body.spend.timestamp,
                      signature: payload.body.spend.signature,
                    },
                    issuer,
                  );
                  span.setAttribute("signature.valid", valid);
                  if (!valid) captureException(new Error("invalid panda signature"), { level: "error" });
                },
              ).catch((error: unknown) => captureException(error, { level: "error" }));
            }

            try {
              await refund.enqueue(
                {
                  account,
                  amount: refundAmount,
                  signature: await signIssuerOp({ account, amount: -BigInt(refundAmount), timestamp }, issuer), // TODO replace with payload signature
                  timestamp,
                },
                payload.id,
              );
            } catch (error: unknown) {
              captureException(error, {
                level: "error",
                tags: { queue: refundName, job: refundName },
                extra: { id: payload.id },
              });
              return c.json(
                { code: error instanceof Error ? error.message : String(error) },
                569 as UnofficialStatusCode,
              );
            }
            return c.json({ code: "ok" });
          }
        // falls through
        case "created": {
          const card = await database.query.cards.findFirst({
            columns: { mode: true },
            where: eq(cards.id, payload.body.spend.cardId),
            with: { credential: { columns: { account: true, id: true, source: true } } },
          });
          if (!card) return c.json({ code: "card not found" }, 404);

          const account = v.parse(Address, card.credential.account);
          setUser({ id: account });

          if (payload.body.spend.status === "declined") {
            getActiveSpan()?.setAttributes({
              [SEMANTIC_ATTRIBUTE_SENTRY_OP]: "panda.tx.declined",
              ...(payload.body.spend.declinedReason && { "span.description": payload.body.spend.declinedReason }),
            });
            const mutex = getMutex(account);
            mutex?.release();
            setContext("mutex", { locked: mutex?.isLocked() });

            const requestedReason =
              payload.body.spend.declinedReason?.toLowerCase() === "webhook declined"
                ? await getRequestedDeclineReason(payload.body.id, payload.body.spend.cardId, database)
                : undefined;
            const rawDeclineReason = requestedReason ?? payload.body.spend.declinedReason;
            if (
              (await reject(payload, jsonBody, rawDeclineReason ?? "transaction declined", database)) &&
              payload.action === "created"
            ) {
              sendDeclinedNotification(
                account,
                payload.body.spend,
                declineMessage(rawDeclineReason) ?? "transaction declined",
                onesignal,
              ).catch((error: unknown) => captureException(error, { level: "error" }));
            }

            trackRejected(account, payload, card.mode, card.credential.source, segment);
            sardine
              .feedback({
                kind: "issuing",
                customer: { id: card.credential.id },
                transaction: { id: payload.body.id },
                feedback: {
                  type: "authorization",
                  status: "network_declined",
                  reason: payload.body.spend.declinedReason ?? "unknown",
                },
              })
              .catch((error: unknown) => captureException(error, { level: "error" }));
            webhook.enqueue({}, payload.id).catch((error: unknown) =>
              captureException(error, {
                level: "error",
                tags: { queue: hookName, job: hookName },
                extra: { id: payload.id },
              }),
            );
            return c.json({ code: "ok" });
          }
          if (payload.body.spend.amount < 0) {
            sardine
              .feedback({
                kind: "issuing",
                customer: { id: card.credential.id },
                transaction: { id: payload.body.id },
                feedback: { type: "authorization", status: "approved" },
              })
              .catch((error: unknown) => captureException(error, { level: "error" }));

            webhook.enqueue({}, payload.id).catch((error: unknown) =>
              captureException(error, {
                level: "error",
                tags: { queue: hookName, job: hookName },
                extra: { id: payload.id },
              }),
            );

            return c.json({ code: "ok" });
          }
          if (payload.body.spend.status !== "pending" && payload.action !== "completed") return c.json({ code: "ok" });
          getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "panda.tx.collect");

          try {
            const { call } = await prepareCollection(card, payload, database, issuer, panda, wallet);
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

              sardine
                .feedback({
                  kind: "issuing",
                  customer: { id: card.credential.id },
                  transaction: { id: payload.body.id },
                  feedback: {
                    ...(payload.action === "created" || payload.action === "updated"
                      ? { type: "authorization", status: "approved" }
                      : { type: "settlement", status: "settled" }),
                  },
                })
                .catch((error: unknown) => captureException(error, { level: "error" }));

              webhook.enqueue({}, payload.id).catch((error: unknown) =>
                captureException(error, {
                  level: "error",
                  tags: { queue: hookName, job: hookName },
                  extra: { id: payload.id },
                }),
              );

              return c.json({ code: "ok" });
            }
            try {
              await wallet.exaSend(
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
                            and(
                              eq(transactions.id, payload.body.id),
                              eq(transactions.cardId, payload.body.spend.cardId),
                            ),
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
                  onReceipt: (receipt) =>
                    receipt.status === "reverted"
                      ? undefined
                      : webhook
                          .enqueue(
                            {
                              receipt: {
                                blockNumber: Number(receipt.blockNumber),
                                transactionHash: receipt.transactionHash,
                              },
                            },
                            payload.id,
                          )
                          .catch((error: unknown) =>
                            captureException(error, {
                              level: "error",
                              tags: { queue: hookName, job: hookName },
                              extra: { id: payload.id },
                            }),
                          ),
                },
              );

              if (
                payload.action === "created" ||
                (payload.action === "completed" &&
                  payload.body.spend.amount > 0 &&
                  !payload.body.spend.authorizedAmount) // force capture
              ) {
                onesignal
                  .sendPushNotification({
                    userId: account,
                    headings: t("Card purchase"),
                    contents: t("{{amount}} at {{merchantName}}. Paid in {{count}} installments", {
                      count: card.mode,
                      amount: f(payload.body.spend.localAmount / 100, payload.body.spend.localCurrency),
                      merchantName: payload.body.spend.merchantName.trim(),
                    }),
                  })
                  .catch((error: unknown) => captureException(error, { level: "error" }));
              }
              switch (payload.action) {
                case "created":
                case "updated":
                  sardine
                    .feedback({
                      kind: "issuing",
                      customer: { id: card.credential.id },
                      transaction: { id: payload.body.id },
                      feedback: { type: "authorization", status: "approved" },
                    })
                    .catch((error: unknown) => captureException(error, { level: "error" }));
                  break;
                case "completed":
                  sardine
                    .feedback({
                      kind: "issuing",
                      customer: { id: card.credential.id },
                      transaction: { id: payload.body.id, amount: payload.body.spend.amount / 100 },
                      feedback: { type: "settlement", status: "settled" },
                    })
                    .catch((error: unknown) => captureException(error, { level: "error" }));
                  break;
              }
              return c.json({ code: "ok" });
            } catch (error: unknown) {
              if (
                error instanceof BaseError &&
                error.cause instanceof ContractFunctionRevertedError &&
                error.cause.data?.errorName === "Replay"
              ) {
                getActiveSpan()?.setAttributes({ "panda.replay": true });
                return c.json({ code: "ok" });
              }
              const settlement = payload.action === "completed";
              const transaction = await database.query.transactions
                .findFirst({
                  where: and(eq(transactions.id, payload.body.id), eq(transactions.cardId, payload.body.spend.cardId)),
                })
                .then((tx) => ({ failed: false, tx }))
                .catch((lookupError: unknown) => {
                  captureException(lookupError, {
                    level: "error",
                    tags: {
                      unhandled: true,
                      "panda.failure": "collection",
                      "panda.query": "transaction",
                    },
                    contexts: { tx: { call } },
                  });
                  return { failed: true, tx: null };
                });
              const tx = transaction.tx;
              const reason = revertReason(error, { fallback: "message" });
              const reasonName = revertReason(error, { fallback: "name" });
              const merchant = {
                name: payload.body.spend.merchantName,
                category: payload.body.spend.merchantCategory,
                city: payload.body.spend.merchantCity,
                country: payload.body.spend.merchantCountry,
              };
              segment.track({
                userId: account,
                event: "TransactionRejected",
                properties: {
                  cardMode: card.mode,
                  declinedReason: `collection:${payload.action}:${call.functionName}:${reason}`,
                  id: payload.body.id,
                  reasonName,
                  source: card.credential.source,
                  updated: payload.action !== "created",
                  usdAmount: payload.body.spend.amount / 100,
                  merchant,
                },
              });
              segment.track({
                userId: account,
                event: "PandaCollectionFailed",
                properties: {
                  action: payload.action,
                  amount: payload.body.spend.amount,
                  authorizedAmount: payload.body.spend.authorizedAmount ?? null,
                  cardMode: card.mode,
                  functionName: call.functionName,
                  id: payload.body.id,
                  knownTransaction: Boolean(tx),
                  merchant,
                  reason,
                  reasonName,
                  settlement,
                  source: card.credential.source,
                  usdAmount: payload.body.spend.amount / 100,
                  webhookId: payload.id,
                },
              });
              captureException(error, {
                level: "fatal",
                fingerprint: [
                  "{{ default }}",
                  "panda.collection",
                  payload.action,
                  call.functionName,
                  ...revertFingerprint(error).slice(1),
                ],
                tags: {
                  unhandled: true,
                  "panda.failure": "collection",
                  "panda.function": call.functionName,
                  "panda.reason": reason,
                  "panda.reasonName": reasonName,
                  "panda.settlement": String(settlement),
                },
                contexts: {
                  tx: { call },
                  pandaCollection: {
                    action: payload.action,
                    cardId: payload.body.spend.cardId,
                    transactionId: payload.body.id,
                    amount: payload.body.spend.amount,
                    authorizedAmount: payload.body.spend.authorizedAmount ?? null,
                    authorizationMethod: payload.body.spend.authorizationMethod ?? null,
                    knownTransaction: Boolean(tx),
                    reason,
                    reasonName,
                    webhookId: payload.id,
                  },
                },
              });
              const revert =
                error instanceof BaseError ? error.walk((r) => r instanceof ContractFunctionRevertedError) : undefined;
              if (
                settlement &&
                revert instanceof ContractFunctionRevertedError &&
                revert.data?.errorName === "InsufficientAccountLiquidity"
              ) {
                debug("suspicious-user:%j", {
                  eventId: payload.id,
                  transactionId: payload.body.id,
                  userId: payload.body.spend.userId,
                  account,
                  amount: payload.body.spend.amount,
                });
                await panda.updateUser({ id: payload.body.spend.userId, isActive: false });
                getActiveSpan()?.setAttributes({ "panda.suspicious": true, "panda.amount": payload.body.spend.amount });
                return c.text(error instanceof Error ? error.message : String(error), 556 as UnofficialStatusCode);
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
  return { app, ready: Promise.resolve() };
}

function trackAuthorized(
  account: Address,
  payload: v.InferOutput<typeof Transaction>,
  cardMode: number,
  source: null | string,
  segment: ReturnType<typeof createSegment>,
): void {
  segment.track({
    userId: account,
    event: "TransactionAuthorized",
    properties: {
      type: "panda",
      cardMode,
      source,
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
  source: null | string,
  declinedReason: string,
  segment: ReturnType<typeof createSegment>,
): void {
  segment.track({
    userId: account,
    event: "AuthorizationRejected",
    properties: {
      cardMode,
      source,
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

function trackRejected(
  account: Address,
  payload: v.InferOutput<typeof Transaction>,
  cardMode: number,
  source: null | string,
  segment: ReturnType<typeof createSegment>,
): void {
  if (payload.action !== "created" && payload.action !== "updated") {
    captureException(new Error("unsupported transaction type"), { contexts: { payload } });
    return;
  }
  segment.track({
    userId: account,
    event: "TransactionRejected",
    properties: {
      id: payload.body.id,
      cardMode,
      source,
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
  card: { credential: { account: string }; mode: number },
  payload: v.InferOutput<typeof Transaction>,
  database: Database,
  issuer: LocalAccount,
  panda: ReturnType<typeof createPanda>,
  wallet: ReturnType<typeof createWallet>,
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
          if (!tx || !v.parse(TransactionPayload, tx.payload).bodies.some((b) => b.action === "created")) {
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
    const signature = await signIssuerOp({ account, amount, timestamp }, issuer); // TODO replace with payload signature
    if (payload.body.spend.signature) {
      await startSpan(
        {
          name: "panda.signature",
          op: "panda.signature",
          attributes: {
            "signature.account": account,
            "signature.amount": String(amount),
            "signature.timestamp": String(payload.body.spend.timestamp ?? 0),
          },
        },
        async (span) => {
          if (!payload.body.spend.signature) throw new Error("signature not found");
          if (!payload.body.spend.timestamp) throw new Error("timestamp not found");
          const valid = await panda.verifyPandaSignature(
            {
              account,
              amount,
              timestamp: payload.body.spend.timestamp,
              signature: payload.body.spend.signature,
            },
            issuer,
          );
          span.setAttribute("signature.valid", valid);
          if (!valid) captureException(new Error("invalid panda signature"), { level: "error" });
        },
      ).catch((error: unknown) => captureException(error, { level: "error" }));
    }

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
      from: wallet.account.address,
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
    ...(calls?.flatMap((call) => usdcTransfersToCollectors(call)) ?? []),
  ];
}

type Database = NodePgDatabase<typeof schema>;

type TransferLog = {
  address: Hex;
  data: Hex;
  position: Hex;
  topics: [Hash, Hash, Hash];
};

class PandaError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public rejectionCode: "INSUFFICIENT_FUNDS" | "NOT_PERMITTED" | "UNKNOWN" = "UNKNOWN",
  ) {
    super(message);
    this.name = "PandaError";
  }
}

async function getRequestedDeclineReason(transactionId: string, cardId: string, database: Database) {
  const transaction = await database.query.transactions.findFirst({
    columns: { payload: true },
    where: and(eq(transactions.id, transactionId), eq(transactions.cardId, cardId)),
  });
  if (!transaction) return;

  const payload = v.safeParse(
    v.object({
      bodies: v.array(
        v.looseObject({
          action: v.string(),
          body: v.looseObject({ spend: v.looseObject({ declinedReason: v.nullish(v.string()) }) }),
          reason: v.optional(v.string()),
        }),
      ),
    }),
    transaction.payload,
  );
  if (!payload.success) return;
  const requested = payload.output.bodies.findLast(({ action }) => action === "requested");
  return requested?.body.spend.declinedReason ?? requested?.reason;
}

async function sendDeclinedNotification(
  account: Address,
  spend: v.InferOutput<typeof Transaction>["body"]["spend"],
  reason: string,
  onesignal: ReturnType<typeof createOnesignal>,
) {
  await onesignal.sendPushNotification({
    userId: account,
    headings: t("Exa Card purchase rejected"),
    contents: t("Transaction at {{merchantName}} for {{amount}} rejected: {{reason}}", {
      amount: f(spend.localAmount / 100, spend.localCurrency),
      merchantName: spend.merchantName.trim(),
      reason: t(reason),
    }),
  });
}

async function reject(
  payload: v.InferOutput<typeof Transaction>,
  jsonBody: unknown,
  declineReason: string,
  database: Database,
) {
  const { spend } = payload.body;
  const transactionId = payload.body.id ?? payload.id;

  const rawBody = v.parse(v.looseObject({ body: v.looseObject({ spend: v.looseObject({}) }) }), jsonBody);
  const createdAt = getCreatedAt(payload) ?? new Date().toISOString();
  const declinedBody = {
    ...rawBody,
    ...(payload.action === "requested" && {
      body: { ...rawBody.body, spend: { ...rawBody.body.spend, declinedReason: declineReason } },
    }),
    createdAt,
    status: "declined",
  };

  return database
    .insert(transactions)
    .values({
      id: transactionId,
      cardId: spend.cardId,
      hashes: [zeroHash],
      payload: { bodies: [declinedBody], type: "panda" },
    })
    .onConflictDoUpdate({
      target: transactions.id,
      set: {
        hashes: sql`${transactions.hashes} || ARRAY[${zeroHash}]::text[]`,
        payload: sql`jsonb_set(
            ${transactions.payload},
            '{bodies}',
            COALESCE(${transactions.payload}::jsonb->'bodies', '[]'::jsonb) || ${JSON.stringify([declinedBody])}::jsonb
          )`,
      },
      ...(payload.action === "created" && {
        setWhere: sql`NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(${transactions.payload}::jsonb->'bodies', '[]'::jsonb)) AS body
          WHERE body->>'id' = ${payload.id}
        )`,
      }),
    })
    .returning({ id: transactions.id })
    .then((result) => result.length > 0)
    .catch((error: unknown) => {
      captureException(error, { level: "error" });
    });
}
