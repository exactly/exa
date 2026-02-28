import { vValidator } from "@hono/valibot-validator";
import { captureEvent, captureException, setUser } from "@sentry/core";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator } from "hono/validator";
import {
  array,
  boolean,
  literal,
  number,
  object,
  picklist,
  pipe,
  safeParse,
  string,
  transform,
  unknown,
  variant,
  type InferInput,
} from "valibot";

import { Address } from "@exactly/common/validation";

import database, { credentials } from "../database";
import { sendPushNotification } from "../utils/onesignal";
import {
  convertBalanceToUsdc,
  ErrorCodes,
  OrderStatus,
  UserOnboardingTasks,
  UserStatus,
  withdrawBalance,
  WithdrawStatus,
} from "../utils/ramps/manteca";
import { track } from "../utils/segment";
import validatorHook from "../utils/validatorHook";
import verifySignature from "../utils/verifySignature";

const webhooksKey = process.env.MANTECA_WEBHOOKS_KEY;
if (!webhooksKey) throw new Error("missing manteca webhooks key");

const debug = createDebug("exa:manteca");
Object.assign(debug, { inspectOpts: { depth: undefined } });

const DepositDetectedData = object({
  id: string(),
  asset: string(),
  amount: string(),
  userExternalId: string(),
  userNumberId: string(),
  userLegalId: string(),
  network: string(),
});

const Payload = variant("event", [
  object({ event: literal("DEPOSIT_DETECTED"), data: DepositDetectedData }),
  object({
    event: literal("USER_ONBOARDING_UPDATE"),
    data: pipe(
      object({
        updatedTasks: array(string()),
        user: object({
          email: string(),
          id: string(),
          numberId: string(),
          externalId: string(),
          exchange: string(),
          status: picklist(UserStatus),
          onboarding: UserOnboardingTasks,
        }),
      }),
      transform((data) => ({ ...data, userExternalId: data.user.externalId })),
    ),
  }),
  object({ event: literal("USER_STATUS_UPDATE"), data: unknown() }),
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
    event: literal("COMPLIANCE_NOTICE"),
    data: variant("type", [
      object({
        type: literal("CLOSE_TO_OPERATION_LIMIT"),
        exchange: string(),
        legalId: string(),
        message: string(),
        payload: object({ limit: number(), operatedAmount: number(), timeframe: string() }),
      }),
      object({
        type: literal("OPERATION_LIMIT_UPDATED"),
        exchange: string(),
        message: string(),
        payload: object({
          expirationTime: string(),
          limitAction: string(),
          timeframe: string(),
          updateReason: string(),
        }),
      }),
    ]),
  }),
  object({
    event: literal("PAYMENT_REFUND"),
    data: object({
      amount: string(),
      asset: string(),
      network: string(),
      partial: boolean(),
      paymentNumberId: string(),
      refundReason: string(),
      refundedAt: string(),
      userId: string(),
      userNumberId: string(),
    }),
  }),
  object({ event: literal("SYSTEM_NOTICE"), data: unknown() }),
]);

export default new Hono().post(
  "/",
  vValidator("json", Payload, validatorHook({ code: "bad manteca", status: 200, debug })),
  headerValidator(new Set([webhooksKey])),
  async (c) => {
    const payload = c.req.valid("json");

    if (payload.event === "USER_STATUS_UPDATE") {
      return c.json({ code: "deprecated" }, 200);
    }

    if (payload.event === "SYSTEM_NOTICE") {
      captureEvent({ message: "MantecaSystemNotice", level: "info" });
      return c.json({ code: "ok" }, 200);
    }

    if (payload.event === "COMPLIANCE_NOTICE") {
      // TODO evaluate send a push notification
      captureEvent({ message: "MantecaComplianceNotice", level: "info" });
      return c.json({ code: "ok" }, 200);
    }

    if (payload.event === "PAYMENT_REFUND") {
      // TODO retrieve the userExternalId from manteca to continue with the flow
      captureEvent({ message: "MantecaPaymentRefund", level: "info" });
      return c.json({ code: "ok" }, 200);
    }

    const rawAccount = `0x${payload.data.userExternalId}`;
    const result = safeParse(Address, rawAccount);
    if (!result.success) {
      captureException(new Error("invalid account address"), { level: "error", contexts: { details: { rawAccount } } });
      return c.json({ code: "invalid account address" }, 200);
    }
    const account = result.output;
    setUser({ id: account });

    const credential = await database.query.credentials.findFirst({
      columns: { account: true, source: true },
      where: eq(credentials.account, account),
    });
    if (!credential) {
      captureException(new Error("credential not found"), { level: "error", contexts: { details: { account } } });
      return c.json({ code: "credential not found" }, 200);
    }

    switch (payload.event) {
      case "DEPOSIT_DETECTED":
        await handleDepositDetected(payload.data, account);
        return c.json({ code: "ok" }, 200);
      case "ORDER_STATUS_UPDATE":
        if (payload.data.status === "CANCELLED") {
          captureException(new Error("order cancelled"), { level: "error", contexts: { details: { account } } });
          await convertBalanceToUsdc(payload.data.userNumberId, payload.data.against);
          return c.json({ code: "ok" }, 200);
        }
        if (payload.data.status === "COMPLETED") {
          track({
            userId: account,
            event: "Onramp",
            properties: {
              currency: payload.data.against,
              fiatAmount: Number(payload.data.assetAmount) * Number(payload.data.effectivePrice),
              provider: "manteca",
              source: credential.source,
              usdcAmount: Number(payload.data.assetAmount),
            },
          });
          await withdrawBalance(payload.data.userNumberId, payload.data.asset, account);
          return c.json({ code: "ok" }, 200);
        }
        return c.json({ code: "ok" }, 200);
      case "WITHDRAW_STATUS_UPDATE":
        if (payload.data.status === "CANCELLED") {
          await withdrawBalance(payload.data.userNumberId, payload.data.asset, account);
          return c.json({ code: "ok" }, 200);
        }
        return c.json({ code: "ok" }, 200);
      case "USER_ONBOARDING_UPDATE":
        if (
          payload.data.user.status === "ACTIVE" &&
          payload.data.updatedTasks.includes("IDENTITY_VALIDATION") &&
          payload.data.user.onboarding.IDENTITY_VALIDATION?.status === "COMPLETED"
        ) {
          track({
            userId: account,
            event: "RampAccount",
            properties: { provider: "manteca", source: credential.source },
          });
          sendPushNotification({
            userId: credential.account,
            headings: { en: "Fiat onramp activated" },
            contents: { en: "Your fiat onramp account has been activated" },
          }).catch((error: unknown) => captureException(error, { level: "error" }));
        }
        return c.json({ code: "ok" }, 200);
      default:
        return c.json({ code: "ok" }, 200);
    }
  },
);

async function handleDepositDetected(data: InferInput<typeof DepositDetectedData>, account: Address) {
  switch (rampDirection(data.asset)) {
    case "offramp":
      break;
    case "onramp":
      await convertBalanceToUsdc(data.userNumberId, data.asset)
        .then(() => {
          sendPushNotification({
            userId: account,
            headings: { en: "Deposited funds" },
            contents: { en: `${data.amount} ${data.asset} deposited` },
          }).catch((error: unknown) => captureException(error, { level: "error" }));
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message.includes(ErrorCodes.INVALID_ORDER_SIZE)) {
            // TODO send a push notification to the user
            captureEvent({ message: "MantecaInvalidOrderSize", level: "error", contexts: { data } });
            return;
          }
          throw error;
        });
  }
}

function rampDirection(asset: string): "offramp" | "onramp" {
  switch (asset) {
    case "USDC":
      return "offramp";
    default:
      return "onramp";
  }
}

function headerValidator(signingKeys: (() => Set<string>) | Set<string>) {
  return validator("header", async ({ "md-webhook-signature": signature }, c) => {
    for (const signingKey of typeof signingKeys === "function" ? signingKeys() : signingKeys) {
      const payload = await c.req.arrayBuffer();
      if (verifySignature({ signature, signingKey, payload })) return;
    }
    return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
  });
}
