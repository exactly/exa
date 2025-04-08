import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import {
  exaPluginAbi,
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
import createDebug from "debug";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { UnofficialStatusCode } from "hono/utils/http-status";
import * as v from "valibot";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  decodeEventLog,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  isHash,
  maxUint256,
  padHex,
} from "viem";

import database, { cards, transactions } from "../database/index";
import { auditorAbi, issuerCheckerAbi, marketAbi } from "../generated/contracts";
import collectors from "../utils/collectors";
import { signIssuerOp } from "../utils/cryptomate";
import keeper from "../utils/keeper";
import { sendPushNotification } from "../utils/onesignal";
import publicClient from "../utils/publicClient";
import { track } from "../utils/segment";
import traceClient, { type CallFrame } from "../utils/traceClient";
import transactionOptions from "../utils/transactionOptions";

if (!process.env.CRYPTOMATE_WEBHOOK_KEY) throw new Error("missing cryptomate webhook key");

const debug = createDebug("exa:cryptomate");
Object.assign(debug, { inspectOpts: { depth: undefined } });

const OperationData = v.object({
  card_id: v.string(),
  bill_amount: v.number(),
  bill_currency_number: v.literal("840"),
  bill_currency_code: v.literal("USD"),
  transaction_amount: v.number(),
  transaction_currency_code: v.pipe(v.string(), v.length(3)),
  created_at: v.pipe(v.string(), v.isoTimestamp()),
  merchant_data: v.object({ name: v.string() }),
  metadata: v.nullish(v.object({ account: v.nullish(Address) })),
});

const CollectData = v.object({
  ...OperationData.entries,
  metadata: v.object({ account: Address }),
  signature: v.string(),
});

const Payload = v.intersect([
  v.variant("event_type", [
    v.object({ event_type: v.literal("AUTHORIZATION"), status: v.literal("PENDING"), data: CollectData }),
    v.variant("status", [
      v.object({ event_type: v.literal("CLEARING"), status: v.literal("PENDING"), data: CollectData }),
      v.object({ event_type: v.literal("CLEARING"), status: v.literal("SUCCESS") }),
      v.object({ event_type: v.literal("CLEARING"), status: v.literal("FAILED") }),
    ]),
    v.object({ event_type: v.literal("DECLINED"), status: v.literal("FAILED") }),
    v.object({ event_type: v.literal("REFUND"), status: v.literal("SUCCESS") }),
    v.object({ event_type: v.literal("REVERSAL"), status: v.literal("SUCCESS") }),
  ]),
  v.object({ product: v.literal("CARDS"), operation_id: v.string(), data: OperationData }),
]);

export default new Hono().post(
  "/",
  vValidator(
    "header",
    v.object({ "x-webhook-key": v.literal(process.env.CRYPTOMATE_WEBHOOK_KEY) }),
    ({ success }, c) => (success ? undefined : c.json("unauthorized", 401)),
  ),
  vValidator("json", Payload, (validation, c) => {
    if (debug.enabled) {
      c.req
        .text()
        .then(debug)
        .catch((error: unknown) => captureException(error));
    }
    if (!validation.success) {
      captureException(new Error("bad cryptomate"), { contexts: { validation } });
      return c.json("bad request", 400);
    }
  }),
  async (c) => {
    const payload = c.req.valid("json");
    setTag("cryptomate.event", payload.event_type);
    setTag("cryptomate.status", payload.status);
    const jsonBody = await c.req.json(); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
    setContext("cryptomate", jsonBody); // eslint-disable-line @typescript-eslint/no-unsafe-argument

    switch (payload.event_type) {
      case "AUTHORIZATION": {
        const { account, amount, call, transaction } = await prepareCollection(payload);
        const authorize = () => {
          track({
            userId: account,
            event: "TransactionAuthorized",
            properties: { type: "cryptomate", usdAmount: payload.data.bill_amount },
          });
          return c.json({ response_code: "00" });
        };
        getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "cryptomate.authorization");
        if (!transaction) return authorize();
        try {
          const trace = await startSpan({ name: "debug_traceCall", op: "tx.trace" }, () =>
            traceClient.traceCall(transaction),
          );
          if (trace.output) {
            let error: string = trace.output;
            try {
              error = decodeErrorResult({
                data: trace.output,
                abi: [
                  ...exaPluginAbi,
                  ...issuerCheckerAbi,
                  ...upgradeableModularAccountAbi,
                  ...auditorAbi,
                  ...marketAbi,
                ],
              }).errorName;
            } catch {} // eslint-disable-line no-empty
            captureException(new Error(error), { contexts: { tx: { call, trace } } });
            return c.json({ response_code: "69" });
          }
          if (
            usdcTransfersToCollectors(trace).reduce(
              (total, { topics, data }) =>
                total + decodeEventLog({ abi: erc20Abi, eventName: "Transfer", topics, data }).args.value,
              0n,
            ) !== amount
          ) {
            debug(`${payload.event_type}:${payload.status}`, payload.operation_id, "bad collection");
            captureException(new Error("bad collection"), { level: "warning", contexts: { tx: { call, trace } } });
            return c.json({ response_code: "51" });
          }
          return authorize();
        } catch (error: unknown) {
          captureException(error, { contexts: { tx: { call } } });
          return c.json({ response_code: "05" });
        }
      }
      case "CLEARING": {
        if (payload.status !== "PENDING") return c.json({});
        getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "cryptomate.clearing");
        const { account, call, mode } = await prepareCollection(payload);
        if (!call) return c.json({});
        return startSpan({ name: "collect credit", op: "exa.collect", attributes: { account } }, async () => {
          try {
            const collect = {
              account: keeper.account,
              address: account,
              abi: [...exaPluginAbi, ...issuerCheckerAbi, ...upgradeableModularAccountAbi],
              ...transactionOptions,
            };
            const { request } = await startSpan({ name: "eth_call", op: "tx.simulate" }, () => {
              if (call.functionName === "collectDebit") return publicClient.simulateContract({ ...collect, ...call });
              if (call.functionName === "collectCredit") return publicClient.simulateContract({ ...collect, ...call });
              return publicClient.simulateContract({ ...collect, ...call });
            });
            setContext("tx", { call, ...request });
            const hash = await startSpan({ name: "eth_sendRawTransaction", op: "tx.send" }, () =>
              keeper.writeContract(request as Parameters<typeof keeper.writeContract>[0]),
            );
            setContext("tx", { call, ...request, transactionHash: hash });
            await database.insert(transactions).values([
              {
                id: payload.operation_id,
                cardId: payload.data.card_id,
                hashes: [hash],
                payload: { ...jsonBody, type: "cryptomate" },
              },
            ]);
            startSpan({ name: "tx.wait", op: "tx.wait" }, () => publicClient.waitForTransactionReceipt({ hash }))
              .then((receipt) => {
                if (receipt.status === "success") return;
                captureException(new Error("tx reverted"), {
                  level: "fatal",
                  contexts: { tx: { call, ...request, ...receipt } },
                });
              })
              .catch((error: unknown) => captureException(error));
            sendPushNotification({
              userId: account,
              headings: { en: "Exa Card Purchase" },
              contents: {
                en: `${payload.data.transaction_amount.toLocaleString(undefined, {
                  style: "currency",
                  currency: payload.data.transaction_currency_code,
                })} at ${payload.data.merchant_data.name}, paid in ${{ 0: "debit", 1: "credit" }[mode] ?? `${mode} installments`} with USDC`,
              },
            }).catch((error: unknown) => captureException(error, { level: "error" }));
            return c.json({});
          } catch (error: unknown) {
            if (
              (error instanceof BaseError &&
                error.cause instanceof ContractFunctionRevertedError &&
                error.cause.data?.errorName === "Expired") ||
              (error instanceof Error &&
                error.message === 'duplicate key value violates unique constraint "transactions_pkey"')
            ) {
              const tx = await database.query.transactions.findFirst({
                where: and(eq(transactions.id, payload.operation_id), eq(transactions.cardId, payload.data.card_id)),
              });
              if (tx?.hashes[0] && isHash(tx.hashes[0])) {
                const receipt = await publicClient.getTransactionReceipt({ hash: tx.hashes[0] }).catch(() => undefined);
                if (receipt?.status === "success") return c.json({});
              }
            }
            captureException(error, { level: "fatal", contexts: { tx: { call } } });
            return c.json(error instanceof Error ? error.message : String(error), 569 as UnofficialStatusCode);
          }
        });
      }
      default:
        return c.json({});
    }
  },
);

async function prepareCollection(payload: v.InferOutput<typeof Payload>) {
  const card = await database.query.cards.findFirst({
    columns: { mode: true },
    where: and(eq(cards.id, payload.data.card_id), eq(cards.status, "ACTIVE")),
    with: { credential: { columns: { account: true } } },
  });
  if (!card) throw new Error("card not found");
  const account = v.parse(Address, card.credential.account);
  setUser({ id: account });
  setTag("exa.mode", card.mode);
  const amount = BigInt(Math.round(payload.data.bill_amount * 1e6));
  if (amount === 0n) return { account, amount, call: null, transaction: null };
  const call = await (async () => {
    const timestamp = Math.floor(new Date(payload.data.created_at).getTime() / 1000);
    const signature = await signIssuerOp({ account, amount, timestamp }); // TODO replace with payload signature
    if (card.mode === 0) {
      return { functionName: "collectDebit", args: [amount, BigInt(timestamp), signature] } as const;
    }
    const nextMaturity = timestamp - (timestamp % MATURITY_INTERVAL) + MATURITY_INTERVAL;
    const firstMaturity =
      nextMaturity - timestamp < MIN_BORROW_INTERVAL ? nextMaturity + MATURITY_INTERVAL : nextMaturity;
    if (card.mode === 1 || payload.data.bill_amount * 100 < card.mode || payload.event_type === "AUTHORIZATION") {
      return {
        functionName: "collectCredit",
        args: [BigInt(firstMaturity + (card.mode - 1) * MATURITY_INTERVAL), amount, BigInt(timestamp), signature],
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
    account,
    amount,
    call,
    mode: card.mode,
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
