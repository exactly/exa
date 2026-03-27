import { vValidator } from "@hono/valibot-validator";
import { captureEvent, captureException, setUser } from "@sentry/core";
import createDebug from "debug";
import { and, DrizzleQueryError, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createHash, createVerify } from "node:crypto";
import { check, literal, object, parse, picklist, pipe, string, unknown, variant } from "valibot";

import { Address } from "@exactly/common/validation";

import database, { credentials } from "../database";
import { sendPushNotification } from "../utils/onesignal";
import { searchAccounts } from "../utils/persona";
import { BridgeCurrency, feeRule, getCustomer, publicKey } from "../utils/ramps/bridge";
import { track } from "../utils/segment";
import validatorHook from "../utils/validatorHook";

const debug = createDebug("exa:bridge");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default new Hono().post(
  "/",
  headerValidator(publicKey),
  vValidator(
    "json",
    variant("event_type", [
      object({ event_type: literal("customer.created"), event_object: unknown() }),
      object({
        event_type: literal("customer.updated.status_transitioned"),
        event_object: object({
          id: string(),
          status: picklist([
            "active",
            "awaiting_questionnaire",
            "awaiting_ubo",
            "incomplete",
            "not_started",
            "offboarded",
            "paused",
            "rejected",
            "under_review",
          ]),
        }),
      }),
      object({ event_type: literal("customer.updated"), event_object: unknown() }),
      object({ event_type: literal("liquidation_address.drain.created"), event_object: unknown() }),
      object({
        event_type: literal("liquidation_address.drain.updated"),
        event_object: unknown(),
      }),
      object({
        event_type: literal("liquidation_address.drain.updated.status_transitioned"),
        event_object: object({
          created_at: pipe(
            string(),
            check((v) => !Number.isNaN(new Date(v).getTime()), "invalid date"),
          ),
          currency: picklist(BridgeCurrency),
          customer_id: string(),
          id: string(),
          state: picklist(["funds_received", "funds_scheduled", "payment_submitted", "payment_processed"]),
          receipt: object({ initial_amount: string(), outgoing_amount: string() }),
        }),
      }),
      object({
        event_type: literal("virtual_account.activity.created"),
        event_object: variant("type", [
          object({ type: literal("account_update"), id: string(), customer_id: string() }),
          object({ type: literal("activation"), id: string(), customer_id: string() }),
          object({ type: literal("deactivation"), id: string(), customer_id: string() }),
          object({ type: literal("funds_received"), id: string(), customer_id: string() }),
          object({ type: literal("funds_scheduled"), id: string(), customer_id: string() }),
          object({ type: literal("in_review"), id: string(), customer_id: string() }),
          object({ type: literal("microdeposit"), id: string(), customer_id: string() }), // cspell:ignore microdeposit
          object({
            created_at: pipe(
              string(),
              check((v) => !Number.isNaN(new Date(v).getTime()), "invalid created at date"),
            ),
            customer_id: string(),
            currency: picklist(BridgeCurrency),
            id: string(),
            type: literal("payment_processed"),
            receipt: object({ initial_amount: string(), final_amount: string() }),
          }),
          object({
            customer_id: string(),
            currency: picklist(BridgeCurrency),
            id: string(),
            type: literal("payment_submitted"),
            receipt: object({ initial_amount: string() }),
          }),
          object({ type: literal("refund"), id: string(), customer_id: string() }),
        ]),
      }),
      object({ event_type: literal("virtual_account.activity.updated"), event_object: unknown() }),
    ]),
    validatorHook({ code: "bad bridge", status: 200, debug }),
  ),
  async (c) => {
    const payload = c.req.valid("json");
    switch (payload.event_type) {
      case "customer.created":
      case "customer.updated":
      case "liquidation_address.drain.created":
      case "liquidation_address.drain.updated":
      case "virtual_account.activity.updated":
        return c.json({ code: "ok" }, 200);
    }

    const bridgeId =
      payload.event_type === "customer.updated.status_transitioned"
        ? payload.event_object.id
        : payload.event_object.customer_id;
    let credential = await database.query.credentials.findFirst({
      columns: { account: true, source: true },
      where: eq(credentials.bridgeId, bridgeId),
    });
    if (!credential && payload.event_type === "customer.updated.status_transitioned") {
      credential = await getCustomer(bridgeId)
        .then((customer) => (customer ? searchAccounts(customer.email) : undefined))
        .then((accounts) => {
          if (accounts && accounts.length > 1)
            captureException(new Error("multiple persona accounts found"), {
              level: "fatal",
              contexts: { details: { bridgeId, matches: accounts.length } },
            });
          return accounts?.length === 1 ? accounts[0]?.attributes["reference-id"] : undefined;
        })
        .then((referenceId) =>
          referenceId
            ? database
                .update(credentials)
                .set({ bridgeId })
                .where(and(eq(credentials.id, referenceId), isNull(credentials.bridgeId)))
                .returning({ account: credentials.account, source: credentials.source })
                .then(([updated]) => {
                  if (!updated) throw new Error("no match found when pairing bridge id");
                  captureEvent({
                    message: "bridge credential paired",
                    level: "warning",
                    contexts: { details: { bridgeId, referenceId } },
                  });
                  return updated;
                })
                .catch((error: unknown): undefined => {
                  if (
                    error instanceof DrizzleQueryError &&
                    error.cause &&
                    "code" in error.cause &&
                    error.cause.code === "23505"
                  ) {
                    captureEvent({
                      message: "bridge credential already paired",
                      level: "fatal",
                      contexts: { details: { bridgeId } },
                    });
                    return;
                  }
                  throw error;
                })
            : undefined,
        );
    }
    if (!credential) {
      captureException(new Error("credential not found"), {
        level: "error",
        contexts: { details: { bridgeId } },
      });
      return c.json({ code: "credential not found" }, 200);
    }
    const account = parse(Address, credential.account);
    setUser({ id: account });

    switch (payload.event_type) {
      case "customer.updated.status_transitioned":
        if (payload.event_object.status !== "active") return c.json({ code: "ok" }, 200);
        track({
          userId: account,
          event: "RampAccount",
          properties: { provider: "bridge", source: credential.source },
        });
        sendPushNotification({
          userId: account,
          headings: { en: "Fiat onramp activated" },
          contents: { en: "Your fiat onramp account has been activated" },
        }).catch((error: unknown) => captureException(error, { level: "error" }));
        return c.json({ code: "ok" }, 200);
      case "virtual_account.activity.created":
        if (payload.event_object.type === "payment_submitted") {
          sendPushNotification({
            userId: account,
            headings: { en: "Deposited funds" },
            contents: {
              en: `${payload.event_object.receipt.initial_amount} ${payload.event_object.currency.toUpperCase()} deposited`,
            },
          }).catch((error: unknown) => captureException(error, { level: "error" }));
        }
        if (payload.event_object.type === "payment_processed") {
          const usdcAmount = Number(payload.event_object.receipt.final_amount);
          if (Number.isNaN(usdcAmount)) {
            captureException(new Error("invalid amount"), {
              level: "error",
              contexts: { details: { usdcAmount: payload.event_object.receipt.final_amount } },
            });
            return c.json({ code: "invalid amount" }, 200);
          }
          await feeRule.report(
            { bridgeId, eventId: payload.event_object.id, amount: Math.round(usdcAmount * 100) },
            new Date(payload.event_object.created_at),
          );
          track({
            userId: account,
            event: "Onramp",
            properties: {
              currency: payload.event_object.currency,
              amount: Number(payload.event_object.receipt.initial_amount),
              provider: "bridge",
              source: credential.source,
              usdcAmount,
            },
          });
        }
        return c.json({ code: "ok" }, 200);
      case "liquidation_address.drain.updated.status_transitioned": {
        if (payload.event_object.state !== "payment_submitted") return c.json({ code: "ok" }, 200);
        const usdcAmount = Number(payload.event_object.receipt.outgoing_amount);
        if (Number.isNaN(usdcAmount)) {
          captureException(new Error("invalid amount"), {
            level: "error",
            contexts: { details: { usdcAmount: payload.event_object.receipt.outgoing_amount } },
          });
          return c.json({ code: "invalid amount" }, 200);
        }
        await feeRule.report(
          { bridgeId, eventId: payload.event_object.id, amount: Math.round(usdcAmount * 100) },
          new Date(payload.event_object.created_at),
        );
        sendPushNotification({
          userId: account,
          headings: { en: "Deposited funds" },
          contents: {
            en: `${payload.event_object.receipt.initial_amount} ${payload.event_object.currency.toUpperCase()} deposited`,
          },
        }).catch((error: unknown) => captureException(error, { level: "error" }));
        track({
          userId: account,
          event: "Onramp",
          properties: {
            currency: payload.event_object.currency,
            amount: Number(payload.event_object.receipt.initial_amount),
            provider: "bridge",
            source: credential.source,
            usdcAmount,
          },
        });
        return c.json({ code: "ok" }, 200);
      }
    }
  },
);

function headerValidator(key: string) {
  return validator("header", async ({ "x-webhook-signature": signature }, c) => {
    if (typeof signature !== "string") return c.json({ code: "unauthorized" }, 401);
    const match = /^t=(\d+),v0=(.+)$/.exec(signature);
    if (!match) return c.json({ code: "unauthorized" }, 401);
    const [, timestamp, base64Signature] = match;
    if (!timestamp || !base64Signature) return c.json({ code: "unauthorized" }, 401);
    if (Math.abs(Date.now() - Number(timestamp)) > 600_000) return c.json({ code: "unauthorized" }, 401);
    const body = Buffer.from(await c.req.arrayBuffer()).toString("utf8");
    const digest = createHash("sha256").update(`${timestamp}.${body}`).digest();
    const verifier = createVerify("RSA-SHA256");
    verifier.update(digest);
    if (!verifier.verify(key, Buffer.from(base64Signature, "base64"))) {
      return c.json({ code: "unauthorized" }, 401);
    }
  });
}
