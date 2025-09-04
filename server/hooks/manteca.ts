import { Address } from "@exactly/common/validation";
import { vValidator } from "@hono/valibot-validator";
import { captureEvent, captureException } from "@sentry/core";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { literal, object, picklist, pipe, string, transform, unknown, variant } from "valibot";

import database, { credentials } from "../database";
import { sendPushNotification } from "../utils/onesignal";
import { convertBalanceToUsdc, OrderStatus, withdrawBalance, WithdrawStatus, UserStatus } from "../utils/ramps/manteca";
import validatorHook from "../utils/validatorHook";
import verifySignature from "../utils/verifySignature";

const webhooksKey = process.env.MANTECA_WEBHOOKS_KEY;
if (!webhooksKey) throw new Error("missing manteca webhooks key");

const debug = createDebug("exa:manteca-hook");
Object.assign(debug, { inspectOpts: { depth: undefined } });

const Payload = variant("event", [
  object({
    event: literal("DEPOSIT_DETECTED"),
    data: object({
      id: string(),
      asset: string(),
      amount: string(),
      userExternalId: string(),
      userNumberId: string(),
      userLegalId: string(),
      network: string(),
    }),
  }),
  object({
    event: literal("ORDER_STATUS_UPDATE"),
    data: object({
      id: string(),
      against: string(),
      asset: string(),
      assetAmount: string(),
      effectivePrice: string(),
      exchange: string(),
      feeInfo: object({ companyProfit: string(), custodyFee: string(), platformFee: string(), totalFee: string() }),
      status: picklist(OrderStatus),
      userExternalId: string(),
      userNumberId: string(),
    }),
  }),
  object({
    event: literal("WITHDRAW_STATUS_UPDATE"),
    data: object({
      id: string(),
      asset: string(),
      amount: string(),
      userExternalId: string(),
      status: picklist(WithdrawStatus),
      userNumberId: string(),
      destination: Address,
    }),
  }),
  object({
    event: literal("USER_STATUS_UPDATE"),
    data: pipe(
      object({
        id: string(),
        email: string(),
        exchange: string(),
        externalId: string(),
        status: picklist(UserStatus),
        numberId: string(),
      }),
      transform((data) => ({ ...data, userExternalId: data.externalId })),
    ),
  }),
  object({ event: literal("SYSTEM_NOTICE"), data: unknown() }),
]);

export default new Hono().post(
  "/",
  vValidator("json", Payload, validatorHook({ code: "bad manteca", status: 200, debug })),
  headerValidator(new Set([webhooksKey])),
  async (c) => {
    const payload = c.req.valid("json");

    if (payload.event === "SYSTEM_NOTICE") {
      captureEvent({ message: "MANTECA SYSTEM NOTICE", contexts: { payload } });
      return c.json({ code: "ok" });
    }

    const user = await database.query.credentials.findFirst({
      columns: { account: true },
      where: eq(credentials.account, `0x${payload.data.userExternalId}`),
    });
    if (!user) {
      captureException(new Error("user not found"), { contexts: { payload } });
      return c.json({ code: "user not found", status: 200 });
    }

    switch (payload.event) {
      case "DEPOSIT_DETECTED":
        await convertBalanceToUsdc(payload.data.userNumberId, payload.data.asset);
        // TODO review text
        sendPushNotification({
          userId: user.account,
          headings: { en: "Deposited funds" },
          contents: { en: `${payload.data.amount} ${payload.data.asset} deposited` },
        }).catch((error: unknown) => captureException(error));
        return c.json({ code: "ok" });
      case "ORDER_STATUS_UPDATE":
        if (payload.data.status === "CANCELLED") {
          captureException(new Error("order cancelled"), { contexts: { payload } });
          await convertBalanceToUsdc(payload.data.userNumberId, payload.data.against);
          return c.json({ code: "ok" });
        }
        if (payload.data.status === "COMPLETED") {
          await withdrawBalance(payload.data.userNumberId, payload.data.asset, user.account);
          return c.json({ code: "ok" });
        }
        return c.json({ code: "ok" });
      case "WITHDRAW_STATUS_UPDATE":
        if (payload.data.status === "CANCELLED") {
          await withdrawBalance(payload.data.userNumberId, payload.data.asset, user.account);
          return c.json({ code: "ok" });
        }
        return c.json({ code: "ok" });
      case "USER_STATUS_UPDATE":
        if (payload.data.status === "ACTIVE") {
          // TODO review text
          sendPushNotification({
            userId: user.account,
            headings: { en: "Fiat onramp activated" },
            contents: { en: "Your fiat onramp account has been activated" },
          }).catch((error: unknown) => captureException(error));
        }
        return c.json({ code: "ok" });
      default:
        return c.json({ code: "ok" });
    }
  },
);

function headerValidator(signingKeys: Set<string> | (() => Set<string>)) {
  return validator("header", async ({ "md-webhook-signature": signature }, c) => {
    for (const signingKey of typeof signingKeys === "function" ? signingKeys() : signingKeys) {
      const payload = await c.req.arrayBuffer();
      if (verifySignature({ signature, signingKey, payload })) return;
    }
    return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
  });
}
