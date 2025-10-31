import domain from "@exactly/common/domain";
import crypto from "node:crypto";
import {
  array,
  boolean,
  type BaseIssue,
  type BaseSchema,
  length,
  literal,
  maxLength,
  number,
  object,
  optional,
  parse,
  picklist,
  pipe,
  string,
  type InferInput,
  variant,
} from "valibot";

if (!process.env.SARDINE_API_KEY) throw new Error("missing sardine api key");
if (!process.env.SARDINE_API_URL) throw new Error("missing sardine api url");

const key = Buffer.from(process.env.SARDINE_API_KEY).toString("base64");
const baseURL = process.env.SARDINE_API_URL;

export async function customer(data: InferInput<typeof CustomerRequest>, timeout = 10_000) {
  return await request(CustomerResponse, "/v1/customers", {}, parse(CustomerRequest, data), "POST", timeout);
}
export async function feedback(data: InferInput<typeof FeedbackRequest>) {
  return await request(FeedbackResponse, "/v1/feedbacks", {}, parse(FeedbackRequest, data), "POST");
}
export default async function risk(data: InferInput<typeof RiskRequest>) {
  return await request(RiskResponse, "/v1/issuing/risks", {}, parse(RiskRequest, data), "POST", 500);
}

async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  url: `/${string}`,
  headers = {},
  body?: unknown,
  method: "GET" | "POST" | "PUT" | "PATCH" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
) {
  const response = await fetch(`${baseURL}${url}`, {
    method,
    headers: {
      ...headers,
      Authorization: `Basic ${key}`,
      "X-Request-Id": crypto.randomUUID(),
      accept: "application/json",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) throw new Error(`${response.status} ${await response.text()} ${url}`);
  const rawBody = await response.arrayBuffer();
  if (rawBody.byteLength === 0) return parse(schema, {});
  return parse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
}

const CustomerRequest = object({
  flow: object({
    id: optional(string(), () => crypto.randomUUID()),
    name: string(),
    type: picklist([
      "signup",
      "onboarding",
      "login",
      "transaction",
      "password_reset",
      "password_change",
      "address_change",
      "email_change",
      "phone_change",
      "payment_method_link",
      "account_update",
      "logout",
      "other",
      "identity_verification",
      "2fa_update",
    ]),
    createdAtMillis: optional(number(), () => Date.now()),
  }),
  sessionKey: optional(string(), () => crypto.randomUUID()),
  customer: optional(
    object({
      id: pipe(string(), maxLength(100)),
      type: optional(
        picklist([
          "customer",
          "sole_proprietor",
          "vendor",
          "business",
          "tenant",
          "owner",
          "institutional",
          "retail",
          "courier",
          "driver",
          "controlling_officer",
          "beneficial_owner",
          "applicant",
          "coapplicant", //cspell:ignore coapplicant
          "employee",
          "individual",
          "llc",
          "llp",
          "limited_partnership",
          "ordinary_partnership",
          "plc",
        ]),
      ),
      createdAtMillis: optional(number(), () => Date.now()), //cspell:ignore createdAtMillis
      firstName: optional(pipe(string(), maxLength(100))),
      middleName: optional(pipe(string(), maxLength(100))),
      lastName: optional(pipe(string(), maxLength(100))),
      businessName: optional(pipe(string(), maxLength(100))),
      address: optional(
        object({
          street1: pipe(string(), maxLength(100)),
          street2: optional(pipe(string(), maxLength(100))),
          city: pipe(string(), maxLength(100)),
          regionCode: optional(pipe(string(), maxLength(50))),
          postalCode: pipe(string(), maxLength(20)),
          countryCode: pipe(string(), length(2)),
        }),
      ),
      phone: optional(pipe(string(), maxLength(20))),
      emailAddress: optional(pipe(string(), maxLength(100))),
      isEmailVerified: optional(boolean(), true),
      isPhoneVerified: optional(boolean(), true),
      dateOfBirth: optional(string()),
      taxId: optional(string()),
      status: optional(picklist(["enabled", "disabled"]), "enabled"),
      consentStatus: optional(picklist(["unknown", "optedIn", "optedOut"]), "optedIn"),
      domain: optional(string(), domain),
      tags: optional(
        array(
          object({
            name: string(),
            value: string(),
            type: picklist(["string", "level", "score", "int", "float"]),
          }),
        ),
      ),
    }),
  ),
  device: optional(object({ ip: string(), createdAtMillis: optional(number(), () => Date.now()) })),
  transaction: optional(
    object({
      id: string(),
      status: picklist(["pending", "accepted", "denied_fraud", "denied"]),
      createdAtMillis: optional(number(), Date.now()),
      amount: number(),
      currencyCode: pipe(string(), length(3)),
      sentAmount: optional(number()),
      sentCurrencyCode: optional(pipe(string(), length(3))),
      receivedAmount: optional(number()),
      receivedCurrencyCode: optional(pipe(string(), length(3))),
      itemCategory: string(),
      mcc: string(),
      actionType: optional(
        picklist([
          "buy",
          "sell",
          "deposit",
          "withdraw",
          "refund",
          "exchange",
          "transfer",
          "multiParty",
          "loanRepayment",
          "loanFunding",
          "credit",
          "debit",
        ]),
        "buy",
      ),
      isOutward: optional(boolean(), false),
      paymentMethod: object({
        type: literal("card"),
        card: object({
          last4: pipe(string(), length(4)),
          hash: string(),
          isVerified: optional(boolean(), false),
          brand: optional(string(), "visa"),
          issuerCountry: optional(pipe(string(), length(2)), "US"),
          binCountry: optional(pipe(string(), length(2)), "US"),
          expiryMonth: optional(number()),
          expiryYear: optional(number()),
          network: optional(picklist(["visa", "mastercard", "american_express", "other"]), "visa"),
          type: optional(picklist(["debit", "credit", "prepaid", "virtual", "physical"]), "virtual"),
          creditCardAuthorization: optional(
            object({
              avs: picklist(["match", "nomatch", "not_verified", "error", "nodata"]),
              avsZip: picklist(["match", "nomatch", "not_verified", "error", "nodata"]),
              avsStreet: picklist(["match", "nomatch", "not_verified", "error", "nodata"]),
              cvv: picklist(["match", "nomatch", "not_verified", "not_supported", "error"]),
              threeDs: picklist([
                "success",
                "issuer_not_supported",
                "signature_verification_failed",
                "rejected",
                "frictionless_failed",
                "error",
                "bypassed",
              ]),
              status: string(),
              statusCode: string(),
              processor: string(),
            }),
          ),
        }),
        firstName: optional(string()),
        middleName: optional(string()),
        lastName: optional(string()),
        billingAddress: optional(
          object({
            street1: pipe(string(), maxLength(100)),
            street2: pipe(string(), maxLength(100)),
            city: pipe(string(), maxLength(100)),
            regionCode: pipe(string(), maxLength(50)),
            postalCode: pipe(string(), maxLength(20)),
            countryCode: pipe(string(), length(2)),
            company: pipe(string(), maxLength(100)),
          }),
        ),
      }),
    }),
  ),
});

const CustomerResponse = object({
  sessionKey: string(),
  level: picklist(["very_high", "high", "medium", "low", "unknown"]),
  status: picklist(["Success", "Timeout"]),
  customer: optional(
    object({
      score: number(),
      level: picklist(["very_high", "high", "medium", "low", "unknown"]),
      reasonCodes: optional(array(string())),
    }),
  ),
  transaction: optional(
    object({
      level: picklist(["very_high", "high", "medium", "low", "unknown"]),
      amlLevel: picklist(["very_high", "high", "medium", "low", "unknown"]),
    }),
  ),
});

const FeedbackRequest = object({
  sessionKey: string(),
  kind: literal("issuing"),
  customer: object({ id: string() }),
  transaction: object({ id: string(), amount: optional(number()) }),
  feedback: variant("type", [
    object({
      type: literal("authorization"),
      status: picklist(["approved", "issuer_declined", "network_declined"]),
      id: optional(string(), crypto.randomUUID()),
      scope: optional(picklist(["user", "transaction"]), "user"),
      timeMillis: optional(number(), Date.now()), //cspell:ignore timeMillis
      reason: optional(string()),
    }),
    object({
      type: literal("settlement"),
      status: picklist([
        "settled",
        "chargeback", //cspell:ignore chargeback
        "merchant_dispute",
        "chargeback_reversal", //cspell:ignore chargeback_reversal
        "chargeback_final", //cspell:ignore chargeback_final
        "refund",
      ]),
      id: optional(string(), crypto.randomUUID()),
      scope: optional(picklist(["user", "transaction"]), "user"),
      timeMillis: optional(number(), Date.now()), //cspell:ignore timeMillis
      reason: optional(string()),
    }),
  ]),
});

const FeedbackResponse = object({ status: string() });

const RiskRequest = object({
  sessionKey: pipe(string(), maxLength(100)),
  customerId: string(),
  transaction: object({
    id: string(),
    amount: number(),
    currencyCode: string(),
    createdAtMillis: optional(number(), Date.now()),
    address: object({ countryCode: pipe(string(), length(2)) }),
    type: optional(picklist(["purchase", "cash", "return", "balance_inquiry"])),
    merchant: object({ mcc: string(), id: optional(string()), name: optional(string()) }),
    status: optional(picklist(["attempt", "pending", "challenge", "success", "failure"])),
  }),
  card: optional(
    object({
      id: string(),
      network: optional(picklist(["visa", "mastercard", "american_express", "other"]), "visa"),
      isVirtual: optional(boolean(), true),
    }),
  ),
  checkpoints: optional(array(string())),
});

const RiskResponse = object({
  sessionKey: string(),
  level: picklist(["very_high", "high", "medium", "low", "unknown"]),
  status: string(),
  amlLevel: picklist(["high", "medium", "low"]),
  score: optional(number()),
  reasonCodes: optional(array(string())),
});
