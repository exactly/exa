import { vValidator } from "@hono/valibot-validator";
import { captureException, setUser } from "@sentry/core";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createHash, createVerify } from "node:crypto";
import { literal, object, parse, picklist, string, unknown, variant } from "valibot";

import { Address } from "@exactly/common/validation";

import database, { credentials } from "../database";
import { sendPushNotification } from "../utils/onesignal";
import { BridgeCryptocurrency, BridgeCurrency } from "../utils/ramps/bridge";
import { track } from "../utils/segment";
import validatorHook from "../utils/validatorHook";

const publicKey = process.env.BRIDGE_WEBHOOK_PUBLIC_KEY;
if (!publicKey) throw new Error("missing bridge webhook public key");

const debug = createDebug("exa:bridge");
Object.assign(debug, { inspectOpts: { depth: undefined } });

const Payload = variant("event_type", [
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
  object({
    event_type: literal("virtual_account.activity.created"),
    event_object: variant("type", [
      object({
        type: literal("funds_received"),
        id: string(),
        amount: string(),
        currency: picklist(BridgeCurrency),
        customer_id: string(),
      }),
      object({ type: literal("funds_scheduled"), id: string() }),
      object({ type: literal("payment_submitted"), id: string() }),
      object({ type: literal("payment_processed"), id: string() }),
    ]),
  }),
  object({
    event_type: literal("liquidation_address.drain.created"),
    event_object: object({
      id: string(),
      state: string(),
      amount: string(),
      currency: picklist(BridgeCryptocurrency),
      customer_id: string(),
    }),
  }),
  object({ event_type: literal("customer.created"), event_object: unknown() }),
  object({ event_type: literal("customer.updated"), event_object: unknown() }),
  object({ event_type: literal("virtual_account.activity.updated"), event_object: unknown() }),
  object({ event_type: literal("liquidation_address.drain.updated"), event_object: unknown() }),
  object({ event_type: literal("liquidation_address.drain.updated.status_transitioned"), event_object: unknown() }),
]);

export default new Hono().post(
  "/",
  vValidator("json", Payload, validatorHook({ code: "bad bridge", status: 200, debug })),
  headerValidator(publicKey),
  async (c) => {
    const payload = c.req.valid("json");
    switch (payload.event_type) {
      case "customer.updated.status_transitioned": {
        if (payload.event_object.status !== "active") return c.json({ code: "ok" }, 200);
        const credential = await findCredential(payload.event_object.id);
        if (!credential) {
          captureException(new Error("credential not found"), {
            level: "error",
            contexts: { details: { customerId: payload.event_object.id } },
          });
          return c.json({ code: "credential not found" }, 200);
        }
        const account = parse(Address, credential.account);
        setUser({ id: account });
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
      }
      case "virtual_account.activity.created": {
        if (payload.event_object.type !== "funds_received") return c.json({ code: "ok" }, 200);
        const credential = await findCredential(payload.event_object.customer_id);
        if (!credential) {
          captureException(new Error("credential not found"), {
            level: "error",
            contexts: { details: { customerId: payload.event_object.customer_id } },
          });
          return c.json({ code: "credential not found" }, 200);
        }
        const account = parse(Address, credential.account);
        setUser({ id: account });
        sendPushNotification({
          userId: account,
          headings: { en: "Deposited funds" },
          contents: { en: `${payload.event_object.amount} ${payload.event_object.currency.toUpperCase()} deposited` },
        }).catch((error: unknown) => captureException(error, { level: "error" }));
        track({
          userId: account,
          event: "Onramp",
          properties: {
            currency: payload.event_object.currency,
            fiatAmount: Number(payload.event_object.amount),
            provider: "bridge",
            source: credential.source,
            usdcAmount: Number(payload.event_object.amount),
          },
        });
        return c.json({ code: "ok" }, 200);
      }
      case "liquidation_address.drain.created": {
        const credential = await findCredential(payload.event_object.customer_id);
        if (!credential) {
          captureException(new Error("credential not found"), {
            level: "error",
            contexts: { details: { customerId: payload.event_object.customer_id } },
          });
          return c.json({ code: "credential not found" }, 200);
        }
        const account = parse(Address, credential.account);
        setUser({ id: account });
        sendPushNotification({
          userId: account,
          headings: { en: "Deposited funds" },
          contents: { en: `${payload.event_object.amount} ${payload.event_object.currency.toUpperCase()} deposited` },
        }).catch((error: unknown) => captureException(error, { level: "error" }));
        track({
          userId: account,
          event: "Onramp",
          properties: {
            currency: payload.event_object.currency,
            fiatAmount: Number(payload.event_object.amount),
            provider: "bridge",
            source: credential.source,
            usdcAmount: Number(payload.event_object.amount),
          },
        });
        return c.json({ code: "ok" }, 200);
      }
      default:
        return c.json({ code: "ok" }, 200);
    }
  },
);

function findCredential(bridgeId: string) {
  return database.query.credentials.findFirst({
    columns: { account: true, source: true },
    where: eq(credentials.bridgeId, bridgeId),
  });
}

function headerValidator(key: string) {
  return validator("header", async ({ "x-webhook-signature": signature }, c) => {
    if (typeof signature !== "string") return c.json({ code: "unauthorized" }, 401);
    const match = /^t=(\d+),v0=(.+)$/.exec(signature);
    if (!match) return c.json({ code: "unauthorized" }, 401);
    const [, timestamp, base64Signature] = match;
    if (!timestamp || !base64Signature) return c.json({ code: "unauthorized" }, 401);
    if (Date.now() - Number(timestamp) > 600_000) return c.json({ code: "unauthorized" }, 401);
    const payload = await c.req.arrayBuffer();
    const body = Buffer.from(payload).toString("utf8");
    const digest = createHash("sha256").update(`${timestamp}.${body}`).digest();
    const verifier = createVerify("RSA-SHA256");
    verifier.update(digest);
    if (!verifier.verify(key, Buffer.from(base64Signature, "base64"))) {
      return c.json({ code: "unauthorized" }, 401);
    }
  });
}
