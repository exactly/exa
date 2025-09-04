import { Address } from "@exactly/common/validation";
import { vValidator } from "@hono/valibot-validator";
import { captureEvent, captureException } from "@sentry/core";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import * as v from "valibot";

import database, { credentials } from "../database";
import { sendPushNotification } from "../utils/onesignal";
import { convertBalanceToUsdc, OrderStatus, withdrawBalance, WithdrawStatus, UserStatus } from "../utils/ramps/manteca";
import validatorHook from "../utils/validatorHook";
import verifySignature from "../utils/verifySignature";

const webhooksKey = process.env.MANTECA_WEBHOOKS_KEY;
if (!webhooksKey) throw new Error("missing manteca webhooks key");

const debug = createDebug("exa:manteca-hook");
Object.assign(debug, { inspectOpts: { depth: undefined } });

const Payload = v.variant("event", [
  v.object({
    event: v.literal("DEPOSIT_DETECTED"),
    data: v.object({
      id: v.string(),
      asset: v.string(),
      amount: v.string(),
      userExternalId: v.string(),
      userNumberId: v.string(),
      userLegalId: v.string(),
      network: v.string(),
    }),
  }),
  v.object({
    event: v.literal("ORDER_STATUS_UPDATE"),
    data: v.object({
      id: v.string(),
      against: v.string(),
      asset: v.string(),
      assetAmount: v.string(),
      effectivePrice: v.string(),
      exchange: v.string(),
      feeInfo: v.object({
        companyProfit: v.string(),
        custodyFee: v.string(),
        platformFee: v.string(),
        totalFee: v.string(),
      }),
      status: v.picklist(OrderStatus),
      userExternalId: v.string(),
      userNumberId: v.string(),
    }),
  }),
  v.object({
    event: v.literal("WITHDRAW_STATUS_UPDATE"),
    data: v.object({
      id: v.string(),
      asset: v.string(),
      amount: v.string(),
      userExternalId: v.string(),
      status: v.picklist(WithdrawStatus),
      userNumberId: v.string(),
      destination: Address,
    }),
  }),
  v.object({
    event: v.literal("USER_STATUS_UPDATE"),
    data: v.pipe(
      v.object({
        id: v.string(),
        email: v.string(),
        exchange: v.string(),
        externalId: v.string(),
        status: v.picklist(UserStatus),
        numberId: v.string(),
      }),
      v.transform((data) => ({ ...data, userExternalId: data.externalId })),
    ),
  }),
  v.object({
    event: v.literal("SYSTEM_NOTICE"),
    data: v.unknown(),
  }),
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
          captureException(new Error("withdraw cancelled"), { contexts: { payload } });
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
