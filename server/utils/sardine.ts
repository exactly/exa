import crypto from "node:crypto";
import {
  array,
  boolean,
  brand,
  ip,
  length,
  literal,
  maxLength,
  number,
  object,
  optional,
  parse,
  picklist,
  pipe,
  record,
  regex,
  string,
  toUpperCase,
  transform,
  variant,
  type BaseIssue,
  type BaseSchema,
  type InferInput,
  type InferOutput,
} from "valibot";

import domain from "@exactly/common/domain";

import ServiceError from "./ServiceError";

import type { Context } from "hono";

export default function sardine(key: string, url: string) {
  return { customer, feedback, risk };

  async function customer(data: InferInput<typeof CustomerRequest>, timeout = 10_000) {
    return await request(CustomerResponse, "/v1/customers", {}, parse(CustomerRequest, data), "POST", timeout);
  }

  async function feedback(data: InferInput<typeof FeedbackRequest>) {
    return await request(FeedbackResponse, "/v1/feedbacks", {}, parse(FeedbackRequest, data), "POST", 10_000);
  }

  async function risk(data: InferInput<typeof RiskRequest>) {
    return await request(RiskResponse, "/v1/issuing/risks", {}, parse(RiskRequest, data), "POST", 10_000);
  }

  async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
    schema: BaseSchema<TInput, TOutput, TIssue>,
    path: `/${string}`,
    headers = {},
    body?: unknown,
    method: "GET" | "PATCH" | "POST" | "PUT" = body === undefined ? "GET" : "POST",
    timeout = 10_000,
  ) {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        ...headers,
        Authorization: `Basic ${Buffer.from(key).toString("base64")}`,
        "X-Request-Id": crypto.randomUUID(),
        accept: "application/json",
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) throw new ServiceError("Sardine", response.status, await response.text());
    const rawBody = await response.arrayBuffer();
    if (rawBody.byteLength === 0) throw new Error(`Empty response body from ${path}`);
    return parse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
  }
}

export const IpAddress = pipe(string(), ip(), brand("IpAddress"));
export type IpAddress = InferOutput<typeof IpAddress>;

export const SESSION_TTL = 1800;

export function session(credentialId: string) {
  return `sardine:session:${credentialId}`;
}

export function signals(c: Context, address?: IpAddress) {
  const userAgent = c.req.header("user-agent");
  const language = c.req.header("accept-language");
  return address || userAgent || language
    ? { ...(address && { ip: address }), ...(userAgent && { userAgent }), ...(language && { language }) }
    : undefined;
}

const networks = {
  ARB: "arbitrum",
  BASE: "base",
  BNB: "binance_smart_chain",
  ETH: "ethereum",
  MATIC: "polygon",
  OPT: "optimism",
} as const satisfies Record<string, InferOutput<typeof Network>>;

export function cryptoNetwork(alchemyNetwork: string) {
  const prefix = alchemyNetwork.split("_")[0];
  return prefix && Object.hasOwn(networks, prefix) ? networks[prefix as keyof typeof networks] : undefined;
}

const Checkpoint = picklist([
  "customer",
  "onboarding",
  "login",
  "aml",
  "aml_bank",
  "aml_crypto",
  "payment",
  "ach",
  "withdrawal",
]);

const Network = picklist(["arbitrum", "base", "binance_smart_chain", "ethereum", "optimism", "polygon"]);

const Crypto = object({
  type: literal("crypto"),
  crypto: object({
    assetSymbol: optional(string()),
    network: optional(Network),
    address: string(),
    transactionHash: optional(string()),
  }),
});

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
    createdAtMillis: optional(number()),
  }),
  sessionKey: optional(string(), () => crypto.randomUUID()),
  checkpoints: optional(array(Checkpoint)),
  config: optional(object({ device: boolean() }), { device: false }),
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
      createdAtMillis: optional(number()), //cspell:ignore createdAtMillis
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
      isEmailVerified: optional(boolean()),
      isPhoneVerified: optional(boolean()),
      dateOfBirth: optional(string()),
      taxId: optional(string()),
      status: optional(picklist(["active", "inactive"])),
      consentStatus: optional(picklist(["unknown", "optedIn", "optedOut"])),
      domain: optional(string(), domain),
      income: optional(object({ amount: number(), currencyCode: literal("USD") })),
      tags: optional(
        array(
          variant("type", [
            object({
              name: string(),
              type: literal("string"),
              value: string(),
            }),
            object({
              name: string(),
              type: literal("int"),
              value: number(),
            }),
          ]),
        ),
      ),
    }),
  ),
  device: optional(
    object({
      ip: optional(IpAddress),
      userAgent: optional(string()),
      language: optional(string()),
    }),
  ),
  transaction: optional(
    object({
      id: string(),
      status: optional(picklist(["pending", "accepted", "denied_fraud", "denied"])),
      createdAtMillis: optional(number(), () => Date.now()),
      amount: optional(number()),
      currencyCode: optional(pipe(string(), length(3), toUpperCase())),
      sentAmount: optional(number()),
      sentCurrencyCode: optional(pipe(string(), length(3), toUpperCase())),
      receivedAmount: optional(number()),
      receivedCurrencyCode: optional(pipe(string(), length(3), toUpperCase())),
      itemCategory: optional(string()),
      mcc: optional(string()),
      actionType: optional(
        picklist([
          "buy",
          "sell",
          "deposit",
          "withdraw",
          "refund",
          "topup", //cspell:ignore topup
          "exchange",
          "transfer",
          "multiParty",
          "loanRepayment",
          "loanFunding",
          "credit",
          "debit",
        ]),
      ),
      paymentMethod: variant("type", [
        Crypto,
        object({
          type: literal("card"),
          card: object({
            last4: pipe(string(), length(4)),
            hash: string(),
            isVerified: optional(boolean(), false),
            brand: optional(string(), "visa"),
            issuerCountry: optional(pipe(string(), length(2)), "US"),
            binCountry: optional(pipe(string(), length(2)), "US"),
            expiryMonth: optional(pipe(string(), transform(Number), number())),
            expiryYear: optional(pipe(string(), transform(Number), number())),
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
              street2: optional(pipe(string(), maxLength(100))),
              city: pipe(string(), maxLength(100)),
              regionCode: optional(pipe(string(), maxLength(50))),
              postalCode: pipe(string(), maxLength(20)),
              countryCode: pipe(string(), length(2)),
              company: optional(pipe(string(), maxLength(100))),
            }),
          ),
        }),
      ]),
    }),
  ),
  counterparty: optional(
    object({
      id: string(),
      type: optional(picklist(["customer", "vendor", "business"]), "customer"),
      paymentMethod: Crypto,
    }),
  ),
});

const Level = picklist(["very_high", "high", "medium", "low", "unknown"]);

const CustomerResponse = object({
  sessionKey: string(),
  level: Level,
  status: picklist(["Success", "Timeout"]),
  customer: optional(
    object({
      score: number(),
      level: Level,
      reasonCodes: optional(array(string())),
    }),
  ),
  transaction: optional(object({ level: Level, amlLevel: Level })),
});

const FeedbackRequest = object({
  kind: literal("issuing"),
  customer: object({ id: string() }),
  transaction: object({ id: string(), amount: optional(number()) }),
  feedback: variant("type", [
    object({
      type: literal("authorization"),
      status: picklist(["approved", "issuer_declined", "network_declined"]),
      id: optional(string(), () => crypto.randomUUID()),
      scope: optional(picklist(["user", "session"]), "user"),
      timeMillis: optional(number(), () => Date.now()), //cspell:ignore timeMillis
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
      id: optional(string(), () => crypto.randomUUID()),
      scope: optional(picklist(["user", "session"]), "user"),
      timeMillis: optional(number(), () => Date.now()), //cspell:ignore timeMillis
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
    currencyCode: pipe(string(), length(3), toUpperCase()),
    createdAtMillis: optional(number(), () => Date.now()),
    address: object({ countryCode: pipe(string(), length(2)) }),
    type: optional(picklist(["purchase", "cash", "return", "balance_inquiry"])),
    merchant: object({ mcc: string(), id: optional(string()), name: optional(string()) }),
    status: optional(picklist(["attempt", "pending", "challenge", "success", "failure"])),
    terminal: optional(object({ type: literal("unspecified"), operator: literal("unspecified") }), {
      type: "unspecified",
      operator: "unspecified",
    }),
    entryInfo: optional(
      object({ pan: literal("unspecified"), card: literal("unspecified"), cardHolder: literal("unspecified") }),
      { pan: "unspecified", card: "unspecified", cardHolder: "unspecified" },
    ),
  }),
  card: optional(
    object({
      id: string(),
      network: optional(picklist(["visa", "mastercard", "american_express", "other"]), "visa"),
      isVirtual: optional(boolean(), true),
    }),
  ),
  customString: optional(record(pipe(string(), regex(/^[a-z][\da-z-]*$/i)), string())),
  partnerId: optional(string(), "EXA"),
  partnerName: optional(string(), "EXA"),
  workflowName: optional(string(), "issuing_risk"),
});

const RiskResponse = object({
  sessionKey: string(),
  level: Level,
  status: string(),
  amlLevel: optional(Level),
  score: optional(number()),
  reasonCodes: optional(array(string())),
});
