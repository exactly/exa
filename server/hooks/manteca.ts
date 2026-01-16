import { vValidator } from "@hono/valibot-validator";
import { captureEvent, captureException } from "@sentry/core";
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
  UserStatus,
  withdrawBalance,
  WithdrawStatus,
} from "../utils/ramps/manteca";
import validatorHook from "../utils/validatorHook";
import verifySignature from "../utils/verifySignature";

const webhooksKey = process.env.MANTECA_WEBHOOKS_KEY;
if (!webhooksKey) throw new Error("missing manteca webhooks key");

const debug = createDebug("exa:manteca-hook");
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

const OrderStatusUpdateData = object({
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
});

const WithdrawStatusUpdateData = object({
  id: string(),
  asset: string(),
  amount: string(),
  userExternalId: string(),
  status: picklist(WithdrawStatus),
  userNumberId: string(),
  destination: Address,
});

const UserOnboardingUpdateData = pipe(
  object({
    updatedTasks: array(string()),
    user: object({
      email: string(),
      id: string(),
      numberId: string(),
      externalId: string(),
      exchange: string(),
      status: picklist(UserStatus),
    }),
  }),
  transform((data) => ({ ...data, userExternalId: data.user.externalId })),
);

const PaymentRefundData = object({
  amount: string(),
  asset: string(),
  network: string(),
  partial: boolean(),
  paymentNumberId: string(),
  refundReason: string(),
  refundedAt: string(),
  userId: string(),
  userNumberId: string(),
});

const ComplianceNoticeData = variant("type", [
  object({
    type: literal("CLOSE_TO_OPERATION_LIMIT"),
    exchange: string(),
    legalId: string(),
    message: string(),
    payload: object({
      limit: number(),
      operatedAmount: number(),
      timeframe: string(),
    }),
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
]);

const SystemNoticeData = unknown();

const Payload = variant("event", [
  object({
    event: literal("DEPOSIT_DETECTED"),
    data: DepositDetectedData,
  }),
  object({
    event: literal("USER_ONBOARDING_UPDATE"),
    data: UserOnboardingUpdateData,
  }),
  object({
    event: literal("WITHDRAW_STATUS_UPDATE"),
    data: WithdrawStatusUpdateData,
  }),
  object({
    event: literal("ORDER_STATUS_UPDATE"),
    data: OrderStatusUpdateData,
  }),
  object({ event: literal("COMPLIANCE_NOTICE"), data: ComplianceNoticeData }),
  object({ event: literal("PAYMENT_REFUND"), data: PaymentRefundData }),
  object({ event: literal("SYSTEM_NOTICE"), data: SystemNoticeData }),
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

    if (payload.event === "COMPLIANCE_NOTICE") {
      // TODO evaluate send a push notification
      captureEvent({ message: "MANTECA COMPLIANCE NOTICE", contexts: { payload } });
      return c.json({ code: "ok" });
    }

    if (payload.event === "PAYMENT_REFUND") {
      // TODO retrieve the userExternalId from manteca to continue with the flow
      captureEvent({ message: "MANTECA PAYMENT REFUND", contexts: { payload } });
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
        await handleDepositDetected(payload.data, user.account);
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
      case "USER_ONBOARDING_UPDATE":
        if (payload.data.user.status === "ACTIVE") {
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

async function handleDepositDetected(data: InferInput<typeof DepositDetectedData>, userAccount: string) {
  switch (data.asset) {
    case "USDC": // qr payments
      // TODO
      break;
    default: // onramp
      await convertBalanceToUsdc(data.userNumberId, data.asset)
        .then(() => {
          sendPushNotification({
            userId: userAccount,
            headings: { en: "Deposited funds" },
            contents: { en: `${data.amount} ${data.asset} deposited` },
          }).catch((error: unknown) => captureException(error));
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message.includes(ErrorCodes.INVALID_ORDER_SIZE)) {
            // TODO send a push notification to the user
            captureEvent({ message: "MANTECA INVALID ORDER SIZE", contexts: { data } });
            return;
          }
          throw error;
        });
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
