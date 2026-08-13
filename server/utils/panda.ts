import { vValidator } from "@hono/valibot-validator";
import { captureException, setContext } from "@sentry/node";
import { Mutex, withTimeout, type MutexInterface } from "async-mutex";
import { and, eq, isNull } from "drizzle-orm";
import {
  array,
  boolean,
  check,
  digits,
  email,
  flatten,
  ip,
  ipv4,
  ipv6,
  isoTimestamp,
  length,
  literal,
  looseObject,
  maxLength,
  metadata,
  minLength,
  nullable,
  nullish,
  number,
  object,
  omit,
  optional,
  parse,
  partial,
  picklist,
  pipe,
  record,
  regex,
  safeParse,
  string,
  transform,
  tuple,
  union,
  unknown,
  url as urlValidator,
  uuid,
  variant,
  type BaseIssue,
  type BaseSchema,
  type InferInput,
  type InferOutput,
} from "valibot";
import { recoverTypedDataAddress, type LocalAccount } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain, { issuerCheckerAddress, usdcAddress } from "@exactly/common/generated/chain";
import { BASE_PRODUCT_ID, PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { Address, Hex } from "@exactly/common/validation";
import { proposalManager } from "@exactly/plugin/deploy.json";

import { isBusinessSalt } from "./createCredential";
import { PANDA_BUSINESS_TEMPLATE } from "./persona";
import ServiceError from "./ServiceError";
import verifySignature from "./verifySignature";
import { cards, credentials } from "../database/schema";

import type createPersona from "./persona";
import type createSardine from "./sardine";
import type createSegment from "./segment";
import type * as schema from "../database/schema";
import type createCredit from "../workers/credit/queue";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
export default function panda({ key, url }: { key: string; url: string }) {
  return {
    createCard,
    createCompanyApplication,
    createUser,
    getApplicationStatus,
    getCompanyUsers,
    getCompanyStatus,
    getCard,
    getCards,
    getNonce,
    getPIN,
    getProcessorDetails,
    getSecrets,
    getUser,
    getWebhook,
    getWithdrawal,
    headerValidator: headerValidator(),
    setPIN,
    submitApplication,
    updateApplication,
    updateCard,
    updateUser,
    verify,
    verifyPandaSignature,
    businessApplication,
  };

  async function createCard(
    userId: string,
    productId: typeof BASE_PRODUCT_ID | typeof PLATINUM_PRODUCT_ID | typeof SIGNATURE_PRODUCT_ID,
    { amount = 1_000_000, idempotencyKey }: { amount?: number; idempotencyKey?: string } = {},
  ) {
    return await request(
      CardResponse,
      `/issuing/users/${userId}/cards`,
      idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
      parse(CreateCardRequest, {
        type: "virtual",
        status: "active",
        limit: { amount, frequency: "per7DayPeriod" },
        configuration: {
          productId,
          virtualCardArt:
            chain.id === baseSepolia.id || chain.id === optimismSepolia.id
              ? "0c515d7eb0a140fa8f938f8242b0780a"
              : {
                  [PLATINUM_PRODUCT_ID]: "81e42f27affd4e328f19651d4f2b438e",
                  [SIGNATURE_PRODUCT_ID]: "398c4919514b4ec4927e6a9114a4c816",
                  [BASE_PRODUCT_ID]: "79c1c868c3ae4b4dae2564295e75c357",
                }[productId],
        },
      }),
      "POST",
      10_000,
    );
  }
  async function createUser(user: {
    accountPurpose: string;
    annualSalary: string;
    expectedMonthlyVolume: string;
    ipAddress: string;
    isTermsOfServiceAccepted: true;
    occupation: string;
    personaShareToken: string;
  }) {
    return await request(object({ id: string() }), "/issuing/applications/user", {}, user, "POST", 10_000);
  }
  function createCompanyApplication(
    application: InferInput<typeof CreateCompanyApplicationRequest>,
    options: { idempotencyKey?: string } = {},
  ) {
    return request(
      CompanyApplicationResponse,
      "/issuing/applications/company",
      options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {},
      parse(CreateCompanyApplicationRequest, application),
      "POST",
      10_000,
    );
  }
  function getCompanyUsers(companyId: string) {
    return request(
      array(object({ id: string(), companyId: optional(string()), walletAddress: optional(string()) })),
      `/issuing/users?companyId=${companyId}`,
      {},
      undefined,
      "GET",
      10_000,
    );
  }
  async function getCompanyStatus(companyId: string) {
    const application = await request(
      CompanyApplicationStatusResponse,
      `/issuing/applications/company/${companyId}`,
      {},
      undefined,
      "GET",
      10_000,
    );
    if (application.id !== companyId) throw new Error("panda company id mismatch");
    return application;
  }
  async function getApplicationStatus(applicationId: string) {
    return request(
      ApplicationStatusResponse,
      `/issuing/applications/user/${applicationId}`,
      {},
      undefined,
      "GET",
      10_000,
    );
  }
  async function getCard(cardId: string) {
    return await request(CardResponse, `/issuing/cards/${cardId}`, {}, undefined, "GET", 10_000);
  }
  async function getCards(userId: string) {
    return await request(CardsResponse, `/issuing/cards?userId=${userId}&limit=100`, {}, undefined, "GET", 10_000);
  }
  function getNonce(userId: string) {
    return request(
      object({ nonce: string() }),
      `/issuing/users/${userId}/signatures/generate-nonce`,
      {},
      undefined,
      "GET",
      10_000,
    );
  }
  async function getPIN(cardId: string, sessionId: string) {
    try {
      return await request(
        PINResponse,
        `/issuing/cards/${cardId}/pin`,
        { SessionId: sessionId },
        undefined,
        "GET",
        10_000,
      );
    } catch (error) {
      if (error instanceof ServiceError && error.message.includes("Failed to get PIN, card does not have PIN set")) {
        return parse(PINResponse, { encryptedPin: null });
      }
      throw error;
    }
  }
  function getProcessorDetails(cardId: string) {
    return request(
      object({ processorCardId: string(), timeBasedSecret: string() }),
      `/issuing/cards/${cardId}/processorDetails`,
      {},
      undefined,
      "GET",
      10_000,
    );
  }
  async function getSecrets(cardId: string, sessionId: string) {
    return await request(
      PANResponse,
      `/issuing/cards/${cardId}/secrets`,
      { SessionId: sessionId },
      undefined,
      "GET",
      10_000,
    );
  }
  async function getUser(userId: string) {
    return await request(UserResponse, `/issuing/users/${userId}`, {}, undefined, "GET", 10_000);
  }
  async function getWebhook(id: string) {
    return await request(
      object({
        id: string(),
        requestBody: Payload,
        requestSentAt: pipe(string(), isoTimestamp()),
        responseReceivedAt: optional(pipe(string(), isoTimestamp())),
      }),
      `/issuing/webhooks/${id}`,
    );
  }
  async function getWithdrawal(amount: number, recipient: Address, admin: Address) {
    return await request(
      Withdrawal,
      `/issuing/tenants/signatures/withdrawals?token=${parse(Address, chain.testnet ? "0x29684075a3C86ea11D9964BcAf0F956e801396bD" : usdcAddress)}&amount=${amount}&recipientAddress=${recipient}&adminAddress=${admin}&chainId=${chain.id}`,
    );
  }
  function headerValidator() {
    return vValidator("header", object({ signature: string() }), async (r, c) => {
      if (!r.success) return c.text("bad request", 400);
      const payload = await c.req.arrayBuffer();
      if (verifySignature({ signature: r.output.signature, signingKey: key, payload })) return;
      return c.text("unauthorized", 401);
    });
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
        "Api-Key": key,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const raw = await response.text();
      let type: string | undefined;
      let message = raw;
      try {
        const payload = JSON.parse(raw) as unknown;
        if (typeof payload === "object" && payload !== null) {
          const { error, message: detail } = payload as { error?: unknown; message?: unknown };
          if (typeof error === "string") type = error;
          if (typeof detail === "string") message = detail;
        }
      } catch {} // eslint-disable-line no-empty -- non-json panda errors use fallback classification
      if (!type) {
        const lower = raw.toLowerCase();
        if (response.status === 404 && (!raw || lower.includes("not found"))) type = "NotFoundError";
        if (response.status === 403 && (!raw || lower.includes("not approved"))) type = "ForbiddenError";
      }
      if (message === "Not Found") {
        const entity = path.split("/")[2]?.replace(/s$/, "");
        if (entity) message = entity;
      }
      throw new ServiceError("Panda", response.status, raw, type, message);
    }
    const rawBody = await response.arrayBuffer();
    if (rawBody.byteLength === 0) return parse(schema, {});
    return parse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
  }
  async function setPIN(cardId: string, sessionId: string, pin: { data: string; iv: string }) {
    return await request(
      object({}),
      `/issuing/cards/${cardId}/pin`,
      { SessionId: sessionId },
      { encryptedPin: pin },
      "PUT",
      10_000,
    );
  }
  async function submitApplication(payload: InferInput<typeof SubmitApplicationRequest>) {
    return request(
      ApplicationResponse,
      "/issuing/applications/user",
      { ...("ciphertext" in payload && { encrypted: "true" }) },
      payload,
      "POST",
      10_000,
    );
  }
  async function updateApplication(applicationId: string, payload: InferInput<typeof UpdateApplicationRequest>) {
    return request(object({}), `/issuing/applications/user/${applicationId}`, {}, payload, "PATCH", 10_000);
  }
  async function updateCard(card: {
    billing?: {
      city: string;
      country?: string;
      countryCode: string;
      line1: string;
      line2?: string;
      postalCode: string;
      region: string;
    };
    configuration?: { virtualCardArt: string };
    id: string;
    limit?: {
      amount: number;
      frequency: "per7DayPeriod" | "per24HourPeriod" | "per30DayPeriod" | "perYearPeriod";
    };
    status?: "active" | "canceled" | "locked" | "notActivated";
  }) {
    return await request(CardResponse, `/issuing/cards/${card.id}`, {}, card, "PATCH", 10_000);
  }
  async function updateUser(user: {
    address?: {
      city: string;
      country?: string;
      countryCode: string;
      line1: string;
      line2?: string;
      postalCode: string;
      region: string;
    };
    email?: string;
    firstName?: string;
    id: string;
    isActive?: boolean;
    lastName?: string;
    phoneCountryCode?: string;
    phoneNumber?: string;
  }) {
    return await request(UserResponse, `/issuing/users/${user.id}`, {}, user, "PATCH", 10_000);
  }
  function verify(
    userId: string,
    payload:
      | {
          assertion: {
            clientExtensionResults: Record<string, unknown>;
            id: string;
            rawId: string;
            response: { authenticatorData: string; clientDataJSON: string; signature: string; userHandle?: string };
            type: "public-key";
          };
          authType: "webauthn";
          credential: {
            publicKey: { data: number[]; type: "Buffer" };
            transports: null | string[];
          };
          factory: string;
          salt: string;
          statement: string;
        }
      | { authType: "siwe"; message: string; signature: string },
  ) {
    return request(object({}), `/issuing/users/${userId}/signatures/verify`, {}, payload, "PUT", 10_000);
  }
}

async function verifyPandaSignature(
  {
    account,
    amount,
    timestamp,
    signature,
  }: {
    account: Address;
    amount: bigint;
    signature: Hex;
    timestamp: number;
  },
  issuer: LocalAccount,
) {
  const recovered = await recoverTypedDataAddress({
    domain: {
      chainId: chain.id,
      name: "IssuerChecker",
      version: "1",
      verifyingContract: issuerCheckerAddress,
    },
    types: {
      Collection: [
        { name: "account", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "timestamp", type: "uint40" },
      ],
      Refund: [
        { name: "account", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "timestamp", type: "uint40" },
      ],
    },
    primaryType: amount < 0n ? "Refund" : "Collection",
    message: { account, amount: amount < 0n ? -amount : amount, timestamp },
    signature,
  });
  return parse(Address, recovered) === issuer.address;
}

const PANResponse = object({
  encryptedPan: object({ iv: string(), data: string() }),
  encryptedCvc: object({ iv: string(), data: string() }),
});

const BaseTransaction = object({
  id: string(),
  type: literal("spend"),
  spend: object({
    amount: number(),
    currency: literal("usd"),
    cardId: string(),
    cardType: literal("virtual"),
    localAmount: number(),
    localCurrency: pipe(string(), length(3)),
    merchantCity: nullish(string()),
    merchantCountry: pipe(string(), length(2)),
    merchantCategory: nullish(string()),
    merchantCategoryCode: string(),
    merchantName: string(),
    merchantId: nullish(string()),
    authorizedAt: optional(pipe(string(), isoTimestamp())),
    authorizedAmount: nullish(number()),
    authorizationMethod: optional(string()),
    userId: string(),
    signature: optional(Hex),
    timestamp: optional(number()),
  }),
});

export const Transaction = variant("action", [
  object({
    id: string(),
    resource: literal("transaction"),
    action: literal("created"),
    body: object({
      ...BaseTransaction.entries,
      spend: object({
        ...BaseTransaction.entries.spend.entries,
        status: picklist(["pending", "declined"]),
        declinedReason: optional(string()),
        exchangeRate: optional(number()),
      }),
    }),
  }),
  object({
    id: string(),
    resource: literal("transaction"),
    action: literal("updated"),
    body: object({
      ...BaseTransaction.entries,
      spend: object({
        ...BaseTransaction.entries.spend.entries,
        authorizationUpdateAmount: number(),
        authorizedAt: pipe(string(), isoTimestamp()),
        status: picklist(["declined", "pending", "reversed"]),
        declinedReason: nullish(string()),
        enrichedMerchantIcon: nullish(string()),
        enrichedMerchantName: nullish(string()),
        enrichedMerchantCategory: nullish(string()),
      }),
    }),
  }),
  object({
    id: string(),
    resource: literal("transaction"),
    action: literal("requested"),
    body: object({
      ...BaseTransaction.entries,
      id: optional(string()),
      spend: object({
        ...BaseTransaction.entries.spend.entries,
        authorizedAmount: number(),
        status: literal("pending"),
      }),
    }),
  }),
  object({
    id: string(),
    resource: literal("transaction"),
    action: literal("completed"),
    body: object({
      ...BaseTransaction.entries,
      spend: object({
        ...BaseTransaction.entries.spend.entries,
        authorizedAt: pipe(string(), isoTimestamp()),
        postedAt: pipe(string(), isoTimestamp()),
        status: literal("completed"),
        enrichedMerchantIcon: nullish(string()),
        enrichedMerchantName: nullish(string()),
        enrichedMerchantCategory: nullish(string()),
        exchangeRate: optional(number()),
      }),
    }),
  }),
]);

const Card = variant("action", [
  object({
    id: string(),
    resource: literal("card"),
    action: literal("updated"),
    body: object({
      expirationMonth: pipe(string(), minLength(1), maxLength(2)),
      expirationYear: pipe(string(), length(4)),
      id: string(),
      last4: pipe(string(), length(4)),
      limit: object({
        amount: number(),
        frequency: picklist([
          "per24HourPeriod",
          "per7DayPeriod",
          "per30DayPeriod",
          "perYearPeriod",
          "allTime",
          "perAuthorization",
        ]),
      }),
      status: picklist(["notActivated", "active", "locked", "canceled"]),
      tokenWallets: optional(union([array(literal("Apple")), array(literal("Google Pay"))])),
      type: literal("virtual"),
      userId: string(),
    }),
  }),
  object({
    id: string(),
    resource: literal("card"),
    action: literal("notification"),
    body: object({
      id: string(),
      card: object({ id: string(), userId: nullable(string()) }),
      tokenWallet: string(),
      reasonCode: literal("PROVISIONING_DECLINED"),
      decisionReason: optional(object({ code: string(), description: optional(string()) })),
    }),
  }),
]);

export const kycStatus = [
  "needsVerification",
  "needsInformation",
  "manualReview",
  "notStarted",
  "approved",
  "canceled",
  "pending",
  "denied",
  "locked",
] as const;

export const Payload = variant("resource", [
  Transaction,
  Card,
  object({
    resource: literal("company"),
    action: literal("updated"),
    body: looseObject({ id: string(), applicationStatus: optional(nullable(picklist(kycStatus))) }),
    id: string(),
  }),
  object({
    resource: literal("application"),
    action: string(),
    body: looseObject({ id: string() }),
    id: string(),
  }),
  object({
    resource: literal("dispute"),
    action: string(),
    body: looseObject({ id: string() }),
    id: string(),
  }),
  object({
    resource: literal("user"),
    action: literal("updated"),
    body: object({
      applicationReason: string(),
      applicationStatus: picklist([
        "approved",
        "pending",
        "needsInformation",
        "needsVerification",
        "manualReview",
        "denied",
        "locked",
        "canceled",
      ]),
      firstName: string(),
      id: string(),
      isActive: boolean(),
      isTermsOfServiceAccepted: boolean(),
      lastName: string(),
    }),
    id: string(),
  }),
]);

export const TransactionPayload = object(
  { bodies: array(looseObject({ action: string() }), "invalid transaction payload") },
  "invalid transaction payload",
);

const Withdrawal = object({
  parameters: tuple([Address, Address, pipe(string(), digits()), Address, number(), array(number()), Hex]),
});

export const PINResponse = pipe(
  object({
    encryptedPin: nullable(object({ iv: string(), data: string() })),
  }),
  transform(({ encryptedPin }) => ({ pin: encryptedPin })),
);

const CreateCardRequest = object({
  type: picklist(["physical", "virtual"]),
  status: picklist(["active", "canceled", "locked", "notActivated"]),
  limit: object({
    amount: number(),
    frequency: picklist([
      "perAuthorization",
      "per24HourPeriod",
      "per7DayPeriod",
      "per30DayPeriod",
      "perYearPeriod",
      "allTime",
    ]),
  }),
  configuration: object({
    productId: picklist([BASE_PRODUCT_ID, PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID]),
    virtualCardArt: string(),
  }),
});

const CardResponse = object({
  id: string(),
  userId: string(),
  type: literal("virtual"),
  status: picklist(["active", "canceled", "locked", "notActivated"]),
  limit: object({
    amount: number(),
    frequency: picklist([
      "per24HourPeriod",
      "per7DayPeriod",
      "per30DayPeriod",
      "perYearPeriod",
      "allTime",
      "perAuthorization",
    ]),
  }),
  last4: pipe(string(), length(4)),
  expirationMonth: pipe(string(), minLength(1), maxLength(2)),
  expirationYear: pipe(string(), length(4)),
});

type PandaCard = InferOutput<typeof CardResponse>;

const CardsResponse = array(
  object({
    id: string(),
    status: picklist(["notActivated", "active", "locked", "canceled"]),
    last4: pipe(string(), length(4)),
    expirationMonth: pipe(string(), minLength(1), maxLength(2)),
    expirationYear: pipe(string(), length(4)),
  }),
);

const UserResponse = object({
  id: string(),
  firstName: string(),
  lastName: string(),
  email: string(),
  isActive: boolean(),
  phoneCountryCode: string(),
  phoneNumber: string(),
  applicationStatus: picklist([
    "approved",
    "pending",
    "needsInformation",
    "needsVerification",
    "manualReview",
    "denied",
    "locked",
    "canceled",
  ]),
  applicationReason: string(),
});

export const collectors: Address[] = (
  {
    [optimism.id]: ["0x3a73880ff21ABf9cA9F80B293570a3cBD846eFc5"],
    [base.id]: ["0xaFFAc76bafE73d6F4e7f73E6d43b7CccC94d1813"],
  }[chain.id] ?? ["0xDb90CDB64CfF03f254e4015C4F705C3F3C834400"]
).map((address) => parse(Address, address));

export function declineMessage(reason?: null | string) {
  return reason
    ? ({
        "account credit limit exceeded": "transaction declined",
        "block atm (mcc 6011) transaction exceeding 250.00 usd": "atm limit reached. maximum 250 usd per transaction.",
        "blocked merchant": "this merchant is not accepted",
        "blocked mcc": "this merchant is not accepted",
        "card canceled": "card canceled",
        "card not activated": "card not active",
        "card spending limit exceeded": "card limit exceeded",
        "cvv mismatch": "transaction declined",
        "cvv2 match fail": "transaction declined",
        "expiry mismatch": "transaction declined",
        frozencard: "frozen card", // cspell:ignore frozencard
        insufficientaccountliquidity: "insufficient funds", // cspell:ignore insufficientaccountliquidity
        insufficient_funds: "insufficient funds",
        "invalid pin": "invalid pin",
        "invalid pin attempt limit exceeded": "too many invalid pin attempts",
        merchant_blocked: "this merchant is not accepted",
        "triggers for transactions from mcc 6050 and 6051": "this merchant is not accepted",
        "webhook declined": "transaction declined",
      }[reason.toLowerCase()] ??
        (
          [
            ["advertising services (mcc 7311) transaction velocity limit reached", "advertising limit reached"],
            ["atm (mcc 6011) transaction velocity limit reached", "atm limit reached"],
            ["automatic fuel dispenser velocity limit reached", "fuel limit reached"],
          ] as const
        ).find(([pattern]) => reason.toLowerCase().includes(pattern))?.[1])
    : undefined;
}

// TODO remove code below
export function signIssuerOp(
  { account, amount, timestamp }: { account: Address; amount: bigint; timestamp: number },
  issuer: LocalAccount,
) {
  return issuer.signTypedData({
    domain: { chainId: chain.id, name: "IssuerChecker", version: "1", verifyingContract: issuerCheckerAddress },
    types: {
      Collection: [
        { name: "account", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "timestamp", type: "uint40" },
      ],
      Refund: [
        { name: "account", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "timestamp", type: "uint40" },
      ],
    },
    primaryType: amount < 0n ? "Refund" : "Collection",
    message: { account, amount: amount < 0n ? -amount : amount, timestamp },
  });
}
async function businessApplication(
  credentialId: string,
  accountAddress: Address,
  ipAddress: string | undefined,
  persona: ReturnType<typeof createPersona>,
) {
  if (!safeParse(pipe(string(), ip()), ipAddress).success)
    throw new BusinessApplicationError("missing valid client IP address", "bad request", "bad request");
  const inquiry = await persona.getInquiry(credentialId, PANDA_BUSINESS_TEMPLATE);
  if (!inquiry) throw new BusinessApplicationError("business inquiry not started", "not started", "kyb not started");
  if (inquiry.attributes["reference-id"] !== credentialId)
    throw new BusinessApplicationError("business inquiry does not match credential", "bad request", "bad request");
  switch (inquiry.attributes.status) {
    case "created":
    case "expired":
    case "pending":
      throw new BusinessApplicationError("business inquiry is not started", "not started", "kyb not started");
    case "failed":
    case "declined":
      throw new BusinessApplicationError("business inquiry failed", "bad kyb", "kyb not approved");
    case "needs_review":
      throw new BusinessApplicationError("business inquiry is not complete", "processing", "kyb not approved");
    case "approved":
    case "completed":
      break;
  }
  const account = await persona.getAccount(credentialId, "business");
  if (!account) throw new BusinessApplicationError("business account not started", "not started", "kyb not started");
  const accountResult = safeParse(BusinessAccount, account.attributes);
  if (!accountResult.success || accountResult.output["reference-id"] !== credentialId)
    throw new BusinessApplicationError("business account is not complete", "processing", "kyb not approved");
  const fields = accountResult.output.fields;
  for (const [inquiryName, inquiryField] of Object.entries(inquiry.attributes.fields ?? {})) {
    const name = inquiryName.replaceAll("-", "_");
    if (fields[name]?.value == null && inquiryField.value != null) fields[name] = inquiryField;
  }
  const field = (name: keyof typeof keys) => requireField(fields, keys[name]);
  const expectedSpend = requireField(fields, keys.companyExpectedSpend, "stringOrNumber");
  const person = {
    firstName: field("userFirstName"),
    lastName: field("userLastName"),
    birthDate: field("userBirthDate"),
    nationalId: field("userNationalId"),
    countryOfIssue: field("userCountryOfIssue"),
    email: field("userEmail"),
    phoneCountryCode: field("userPhoneCountryCode"),
    phoneNumber: field("userPhoneNumber"),
    address: toAddress(fields, "_1"),
  };
  const companyName = field("companyName");
  const initialUser = {
    ...person,
    role: "owner",
    ipAddress,
    isTermsOfServiceAccepted: requireField(fields, keys.termsOfServiceAccepted, "boolean"),
    walletAddress: accountAddress,
  };
  const application = safeParse(CreateCompanyApplicationRequest, {
    initialUser,
    name: companyName,
    address: toAddress(fields),
    entity: {
      name: companyName,
      description: field("companyDescription"),
      industry: field("companyIndustry"),
      registrationNumber: field("companyRegistrationNumber"),
      taxId: field("companyTaxId"),
      website: field("companyWebsite"),
      type: field("companyType"),
      expectedSpend: typeof expectedSpend === "number" ? `${expectedSpend}` : expectedSpend,
    },
    representatives: [person],
    ultimateBeneficialOwners: [person],
    sourceKey: "EXA",
    externalId: credentialId,
  });
  if (application.success) return application.output;
  setContext("validation", { flatten: flatten(application.issues) });
  throw new BusinessApplicationError("invalid business Persona fields", "bad request", "bad request");
}

const mutexes = new Map<Address, MutexInterface>();
export const activeCardStatuses: (typeof cards.$inferSelect.status)[] = ["ACTIVE", "FROZEN"];

export async function finalizeBusinessApproval(
  credentialId: string,
  companyId: string,
  account: Address,
  database: NodePgDatabase<typeof schema>,
  client: ReturnType<typeof panda>,
  {
    credit,
    persona,
    sardine,
    segment,
  }: {
    credit: ReturnType<typeof createCredit>;
    persona: ReturnType<typeof createPersona>;
    sardine: ReturnType<typeof createSardine>;
    segment: ReturnType<typeof createSegment>;
  },
) {
  const row = await database.query.credentials.findFirst({
    columns: { pandaCompanyId: true, pandaId: true, salt: true, source: true },
    where: eq(credentials.id, credentialId),
  });
  if (row?.pandaCompanyId !== companyId || !isBusinessSalt(parse(Address, row.salt))) return;
  const existingCards = await database.query.cards.findMany({
    columns: { id: true, status: true },
    where: eq(cards.credentialId, credentialId),
  });
  const localCard = existingCards.find(({ status }) => activeCardStatuses.includes(status));
  const users = await client.getCompanyUsers(companyId);
  if (row.pandaId && !users.some(({ id }) => id === row.pandaId)) throw new Error("company user not found");
  const userId =
    row.pandaId ??
    (await (async () => {
      const user = users.find(({ walletAddress }) => walletAddress?.toLowerCase() === account.toLowerCase());
      if (!user) throw new Error("company user not found");
      const [updated] = await database
        .update(credentials)
        .set({ pandaId: user.id })
        .where(
          and(eq(credentials.id, credentialId), eq(credentials.pandaCompanyId, companyId), isNull(credentials.pandaId)),
        )
        .returning({ id: credentials.id });
      if (updated) return user.id;
      return database.query.credentials
        .findFirst({ columns: { pandaId: true }, where: eq(credentials.id, credentialId) })
        .then((current) => current?.pandaId ?? undefined);
    })());
  if (!userId) return;
  if (localCard) {
    await credit.enqueue(account, `business-approval:${credentialId}:${localCard.id}`);
    return;
  }
  const card = await client.createCard(userId, SIGNATURE_PRODUCT_ID, {
    amount: await cardLimit(credentialId, persona).catch((error: unknown) => {
      captureException(error, {
        level: "error",
        contexts: { details: { credentialId, scope: "cardLimit" } },
      });
      throw error;
    }),
    idempotencyKey: `business-approval:${credentialId}:${existingCards.filter(({ status }) => status === "DELETED").length}`,
  });
  const [inserted] = await database
    .insert(cards)
    .values({ id: card.id, lastFour: card.last4, credentialId, productId: SIGNATURE_PRODUCT_ID })
    .onConflictDoNothing()
    .returning({ id: cards.id });
  if (!inserted) {
    const existing = await database.query.cards.findFirst({ columns: { id: true }, where: eq(cards.id, card.id) });
    if (!existing) return;
    await credit.enqueue(account, `business-approval:${credentialId}:${existing.id}`);
    return;
  }
  segment.track({
    event: "CardIssued",
    userId: account,
    properties: { productId: SIGNATURE_PRODUCT_ID, source: row.source },
  });
  notifyCardIssued(sardine, { credentialId, card });
  await credit.enqueue(account, `business-approval:${credentialId}:${card.id}`);
}

export function cardLimit(credentialId: string, persona: ReturnType<typeof createPersona>) {
  return persona
    .getAccount(credentialId, "cardLimit")
    .then((profile) =>
      profile?.attributes.fields.card_limit_usd?.value == null
        ? undefined
        : profile.attributes.fields.card_limit_usd.value * 100,
    );
}

export function notifyCardIssued(
  sardine: ReturnType<typeof createSardine>,
  {
    card,
    credentialId,
  }: { card: Pick<PandaCard, "expirationMonth" | "expirationYear" | "id" | "last4">; credentialId: string },
) {
  sardine
    .customer({
      flow: { name: "card.issued", type: "payment_method_link" },
      customer: { id: credentialId, type: "customer" },
      transaction: {
        id: card.id,
        paymentMethod: {
          type: "card",
          card: {
            hash: card.id,
            last4: card.last4,
            expiryMonth: card.expirationMonth,
            expiryYear: card.expirationYear,
          },
        },
      },
    })
    .catch((error: unknown) => captureException(error, { level: "error" }));
}

export function createMutex(address: Address) {
  const mutex = withTimeout(
    new Mutex(),
    (proposalManager.delay as Record<number, number>)[chain.id] ?? proposalManager.delay.default * 1000,
  );
  mutexes.set(address, mutex);
  return mutex;
}
export function getMutex(address: Address) {
  return mutexes.get(address);
}

const AddressSchema = object({
  line1: pipe(string(), minLength(1), maxLength(100)),
  line2: optional(pipe(string(), minLength(1), maxLength(100))),
  city: pipe(string(), minLength(1), maxLength(50)),
  region: pipe(string(), minLength(1), maxLength(50)),
  country: optional(pipe(string(), minLength(1), maxLength(50))),
  postalCode: pipe(string(), minLength(1), maxLength(15), regex(/^[a-z0-9 -]{1,15}$/i)),
  countryCode: pipe(string(), length(2), regex(/^[A-Z]{2}$/i)),
});

const CorporatePerson = object({
  firstName: pipe(
    string(),
    check((value) => value.trim().length > 0),
    maxLength(50),
  ),
  lastName: pipe(
    string(),
    check((value) => value.trim().length > 0),
    maxLength(50),
  ),
  birthDate: pipe(string(), regex(/^\d{4}-\d{2}-\d{2}$/)),
  nationalId: pipe(
    string(),
    check((value) => value.trim().length > 0),
    maxLength(50),
  ),
  countryOfIssue: pipe(string(), length(2), regex(/^[A-Z]{2}$/i)),
  email: pipe(string(), email()),
  phoneCountryCode: pipe(string(), minLength(1), maxLength(3), regex(/^\d{1,3}$/)),
  phoneNumber: pipe(string(), minLength(1), maxLength(15), regex(/^\d{1,15}$/)),
  address: AddressSchema,
});

const BusinessAccount = object({
  "reference-id": string(),
  fields: record(string(), object({ value: unknown() })),
});

const CreateCompanyApplicationRequest = object({
  initialUser: object({
    ...CorporatePerson.entries,
    ipAddress: pipe(string(), maxLength(50), ip()),
    isTermsOfServiceAccepted: pipe(boolean(), literal(true)),
    walletAddress: Address,
    role: literal("owner"),
  }),
  name: pipe(string(), minLength(1), maxLength(100)),
  address: AddressSchema,
  entity: object({
    name: pipe(string(), minLength(1), maxLength(100)),
    description: pipe(string(), minLength(1), maxLength(500)),
    industry: pipe(string(), regex(/^\d{6}$/)),
    registrationNumber: pipe(string(), minLength(1), maxLength(100)),
    taxId: pipe(string(), minLength(1), maxLength(100)),
    website: pipe(string(), minLength(1), maxLength(255), urlValidator()),
    type: pipe(string(), minLength(1), maxLength(100)),
    expectedSpend: pipe(string(), minLength(1), maxLength(100)),
  }),
  representatives: array(CorporatePerson),
  ultimateBeneficialOwners: array(CorporatePerson),
  sourceKey: string(),
  externalId: string(),
});

const ApplicationLink = object({
  url: pipe(string(), urlValidator()),
  params: object({ signature: string(), userId: pipe(string(), uuid()) }),
});
const ApplicationReview = {
  applicationReason: optional(nullable(string())),
  applicationCompletionLink: optional(nullable(ApplicationLink)),
  applicationExternalVerificationLink: optional(nullable(ApplicationLink)),
};

export const CompanyApplicationStatusResponse = object({
  id: string(),
  applicationStatus: optional(
    nullable(
      picklist([
        "needsVerification",
        "needsInformation",
        "manualReview",
        "approved",
        "canceled",
        "pending",
        "denied",
        "locked",
      ]),
    ),
  ),
  ...ApplicationReview,
});

export const CompanyApplicationResponse = object({
  ...CompanyApplicationStatusResponse.entries,
  name: string(),
  address: AddressSchema,
  ultimateBeneficialOwners: optional(nullable(array(object({ id: string(), ...ApplicationReview })))),
  externalId: optional(nullable(string())),
  sourceKey: optional(nullable(string())),
});

export class BusinessApplicationError extends Error {
  constructor(
    message: string,
    readonly code: "bad kyb" | "bad request" | "not started" | "processing",
    readonly legacy: "bad request" | "kyb not approved" | "kyb not started",
  ) {
    super(message);
  }
}

const keys = {
  companyName: "i_company_name",
  companyDescription: "company_description",
  companyIndustry: "company_industry",
  companyRegistrationNumber: "company_registration_number",
  companyTaxId: "company_tax_id",
  companyWebsite: "company_website",
  companyType: "company_type",
  companyExpectedSpend: "company_expected_spend",
  userFirstName: "i_auth_user_name",
  userLastName: "i_auth_user_last_name",
  userBirthDate: "birth_date",
  userNationalId: "id_number",
  userCountryOfIssue: "id_country",
  userEmail: "collected_email_address",
  userPhoneCountryCode: "authorized_user_phone_country_code",
  userPhoneNumber: "authorized_user_phone_number",
  termsOfServiceAccepted: "terms_and_conditions",
};

function requireField(
  fields: Record<string, { value: unknown }> | undefined,
  name: string,
  expected: "boolean" | "string" | "stringOrNumber" = "string",
) {
  const value = fields?.[name]?.value;
  if (value == null || (typeof value === "string" && value.trim().length === 0))
    throw new BusinessApplicationError("business account is not complete", "processing", "kyb not approved");
  const valid =
    expected === "stringOrNumber" ? typeof value === "string" || typeof value === "number" : typeof value === expected;
  if (!valid) {
    setContext("validation", { field: name });
    throw new BusinessApplicationError("invalid business Persona fields", "bad request", "bad request");
  }
  return value;
}

function toAddress(fields: Record<string, { value: unknown }> | undefined, suffix = "") {
  const field = (name: string) => requireField(fields, `${name}${suffix}`);
  const line2 = fields?.[`street_2${suffix}`]?.value;
  return {
    line1: field("street_1"),
    line2: line2 == null || line2 === "" ? undefined : line2,
    city: field("city"),
    region: field("subdivision"),
    postalCode: field("postal_code"),
    countryCode: field("country_code"),
  };
}

export const Application = object({
  email: pipe(
    string(),
    email("Invalid email address"),
    metadata({ description: "Email address", examples: ["user@domain.com"] }),
  ),
  lastName: pipe(string(), maxLength(50), metadata({ description: "The person's last name" })),
  firstName: pipe(string(), maxLength(50), metadata({ description: "The person's first name" })),
  nationalId: pipe(string(), maxLength(50), metadata({ description: "The person's national ID" })),
  birthDate: pipe(
    string(),
    regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD format"),
    check((value) => {
      const date = new Date(value);
      return !Number.isNaN(date.getTime());
    }, "must be a valid date"),
    metadata({ description: "Birth date (YYYY-MM-DD)", examples: ["1970-01-01"] }),
  ),
  countryOfIssue: pipe(
    string(),
    length(2),
    regex(/^[A-Z]{2}$/i, "Must be exactly 2 letters"),
    metadata({ description: "The person's country of issue of their national id, as a 2-letter country code" }),
  ),
  phoneCountryCode: pipe(
    string(),
    minLength(1),
    maxLength(3),
    regex(/^\d{1,3}$/, "Must be a valid country code"),
    metadata({ description: "The user's phone country code" }),
  ),
  phoneNumber: pipe(
    string(),
    minLength(1),
    maxLength(15),
    regex(/^\d{1,15}$/, "Must be a valid phone number"),
    metadata({ description: "The user's phone number" }),
  ),
  address: pipe(AddressSchema, metadata({ description: "The person's address" })),
  ipAddress: pipe(
    union([pipe(string(), maxLength(50), ipv4()), pipe(string(), maxLength(50), ipv6())]),
    metadata({ description: "The user's IP address (IPv4 or IPv6)" }),
  ),
  occupation: pipe(string(), maxLength(50), metadata({ description: "The user's occupation" })),
  annualSalary: pipe(string(), maxLength(50), metadata({ description: "The user's annual salary" })),
  accountPurpose: pipe(string(), maxLength(50), metadata({ description: "The user's account purpose" })),
  expectedMonthlyVolume: pipe(string(), maxLength(50), metadata({ description: "The user's expected monthly volume" })),
  isTermsOfServiceAccepted: pipe(
    boolean(),
    literal(true),
    metadata({ description: "Whether the user has accepted the terms of service" }),
  ),
});

export const SubmitApplicationRequest = union([
  Application,
  object({ key: string(), iv: string(), ciphertext: string(), tag: string() }),
]);

export const UpdateApplicationRequest = object({
  ...partial(omit(Application, ["email", "phoneCountryCode", "phoneNumber", "address"])).entries,
  address: optional(AddressSchema),
});

const ApplicationResponse = object({
  id: pipe(string(), maxLength(50)),
  applicationStatus: pipe(string(), maxLength(50)),
});

const ApplicationStatusResponse = object({
  id: string(),
  applicationStatus: picklist(kycStatus),
  applicationReason: optional(string()),
});
