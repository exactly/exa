import Client, { APIError, NotFoundError, PermissionDeniedError } from "@rainapi/rain-sdk";
import { captureException } from "@sentry/node";
import { Mutex, withTimeout, type MutexInterface } from "async-mutex";
import {
  array,
  boolean,
  check,
  digits,
  email,
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
  nonEmpty,
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
  regex,
  strictObject,
  string,
  transform,
  trim,
  tuple,
  union,
  url as urlValidator,
  uuid,
  variant,
  type BaseIssue,
  type BaseSchema,
  type InferInput,
  type InferOutput,
} from "valibot";
import { recoverTypedDataAddress, withRetry, type LocalAccount } from "viem";
import { base, baseSepolia, optimismSepolia } from "viem/chains";

import chain, { isBase, issuerCheckerAddress, usdcAddress } from "@exactly/common/generated/chain";
import {
  BASE_PRODUCT_ID,
  CLASSIC_PRODUCT_ID,
  PHYSICAL_SIGNATURE_PRODUCT_ID,
  PLATINUM_PRODUCT_ID,
  SIGNATURE_PRODUCT_ID,
} from "@exactly/common/panda";
import { Address, Hex } from "@exactly/common/validation";
import { accounts, proposalManager } from "@exactly/plugin/deploy.json";

import ServiceError from "./ServiceError";
import { cards } from "../database/schema";

export const Tenant = picklist(cards.tenant.enumValues);
export type Tenant = InferOutput<typeof Tenant>;

export const home = (): Tenant => (isBase ? "BASE" : "OP");

export const other = (): Tenant => (isBase ? "OP" : "BASE");

export default function panda(config: { key: string; url: string }, baseConfig?: { key: string; url: string }) {
  const remote = baseConfig && !isBase ? connect(baseConfig) : undefined;
  return Object.assign(connect(config), {
    tenants: (): Tenant[] => (remote ? [home(), other()] : [home()]),
    program(this: ReturnType<typeof connect>, target: Tenant) {
      if (target === home()) return this;
      if (!remote) throw new Error(`no ${target} program`);
      return remote;
    },
  });
}

export function pandaUser(credential: { otherPandaId: null | string; pandaId: null | string }, target: Tenant) {
  return target === home() ? credential.pandaId : credential.otherPandaId;
}

export function homeFirst<T extends { tenant: Tenant }>(owned: readonly T[]) {
  return owned.toSorted((a, b) => Number(b.tenant === home()) - Number(a.tenant === home()));
}

export function pickCard<T extends { tenant: Tenant }>(
  credential: { otherPandaId: null | string; pandaId: null | string },
  owned: readonly T[],
) {
  for (const card of homeFirst(owned)) {
    const pandaId = pandaUser(credential, card.tenant);
    if (pandaId) return { ...card, pandaId };
  }
}

function connect({ key, url }: { key: string; url: string }) {
  const client = new Client({
    apiKey: key,
    baseURL: `${url}/issuing`,
    fetch: (input, init) => {
      const signal = AbortSignal.timeout(10_000);
      if (init?.method !== "GET") return fetch(input, { ...init, signal });
      let attempts = 0;
      return withRetry(
        async () => {
          const response = await fetch(input, { ...init, signal });
          if (response.status < 500 || ++attempts > 2) return response;
          throw new ServiceError("Panda", response.status, await response.text());
        },
        {
          signal,
          shouldRetry: ({ error }) => {
            if (!(error instanceof ServiceError)) return false;
            captureException(error, { level: "warning", fingerprint: ["{{ default }}", "panda.retry"] });
            return true;
          },
        },
      );
    },
    maxRetries: 0,
    timeout: 10_000,
  });
  return {
    createCard,
    createCompanyApplication,
    createCompanyUser,
    createUser,
    getApplicationStatus,
    getCompanyApplication,
    getCompanyUsers,
    getCard,
    getCards,
    getContracts,
    getNonce,
    getPIN,
    getProcessorDetails,
    getSecrets,
    getUser,
    getWebhook,
    getWithdrawal,
    setPIN,
    submitApplication,
    updateApplication,
    updateCard,
    updateUser,
    verify,
    verifyPandaSignature,
  };

  async function createCard(
    userId: string,
    productId:
      | typeof BASE_PRODUCT_ID
      | typeof CLASSIC_PRODUCT_ID
      | typeof PHYSICAL_SIGNATURE_PRODUCT_ID
      | typeof PLATINUM_PRODUCT_ID
      | typeof SIGNATURE_PRODUCT_ID,
    amount = 1_000_000,
    idempotencyKey?: string,
    source?: null | string,
    shipping?: InferInput<typeof Shipping>,
  ) {
    return await request(
      CardResponse,
      "user",
      client.users.createCard(
        userId,
        parse(CreateCardRequest, {
          type: productId === PHYSICAL_SIGNATURE_PRODUCT_ID ? "physical" : "virtual",
          status: "active",
          limit: { amount, frequency: "per7DayPeriod" },
          configuration:
            productId === PHYSICAL_SIGNATURE_PRODUCT_ID
              ? { productId, displayName: shipping?.displayName }
              : {
                  productId,
                  virtualCardArt:
                    chain.id === baseSepolia.id || chain.id === optimismSepolia.id
                      ? "0c515d7eb0a140fa8f938f8242b0780a"
                      : chain.id === base.id && productId === SIGNATURE_PRODUCT_ID && source === partner
                        ? "c4c03256d6764a8390f41b60561d27af"
                        : {
                            [BASE_PRODUCT_ID]: "79c1c868c3ae4b4dae2564295e75c357",
                            [CLASSIC_PRODUCT_ID]: "1f3e23aaeb024388a0373c59ff3a5a7e",
                            [PLATINUM_PRODUCT_ID]: "81e42f27affd4e328f19651d4f2b438e",
                            [SIGNATURE_PRODUCT_ID]: "398c4919514b4ec4927e6a9114a4c816",
                          }[productId],
                },
          ...(shipping && {
            shipping: {
              ...shipping,
              country: regions.of(shipping.countryCode) ?? shipping.countryCode,
              method: shipping.countryCode === "US" ? "standard" : "international",
            },
          }),
        }),
        idempotencyKey === undefined ? undefined : { headers: { "Idempotency-Key": `card:${idempotencyKey}` } },
      ),
    );
  }
  async function createUser(
    user: {
      accountPurpose: string;
      annualSalary: string;
      expectedMonthlyVolume: string;
      ipAddress: string;
      isTermsOfServiceAccepted: true;
      occupation: string;
      personaShareToken: string;
    },
    idempotencyKey: string,
  ) {
    return await request(
      object({ id: string() }),
      "application",
      client.applications.user.create(user, { headers: { "Idempotency-Key": `user:${idempotencyKey}` } }),
    );
  }
  async function createCompanyApplication(
    externalId: string,
    company: {
      address: Owner["address"];
      entity: {
        description: string;
        industry: string;
        name: string;
        registrationNumber: string;
        taxId: string;
        website: string;
      };
      initialUser: Owner & { ipAddress: string; walletAddress: Address };
      name: string;
      representatives: Owner[];
      ultimateBeneficialOwners: Owner[];
    },
  ) {
    return request(
      CompanyApplicationResponse,
      "application",
      client.post("/applications/company", {
        body: parse(CreateCompanyApplicationRequest, { ...company, sourceKey: "EXA", externalId }),
        headers: { "Idempotency-Key": `business-application:${externalId}` },
      }),
    );
  }
  async function createCompanyUser(
    companyId: string,
    user: InferInput<typeof CreateCompanyUserRequest>,
    idempotencyKey: string,
  ) {
    return await request(
      CompanyUserResponse,
      "company",
      client.post(`/companies/${companyId}/users`, {
        body: parse(CreateCompanyUserRequest, user),
        headers: { "Idempotency-Key": `company-user:${idempotencyKey}` },
      }),
    );
  }
  async function getCompanyApplication(externalId: string) {
    const application = await request(
      CompanyApplicationStatusResponse,
      "application",
      client.get(`/applications/company/external/${externalId}`),
    ).catch((error: unknown) => {
      if (error instanceof ServiceError && error.status === 404) return;
      throw error;
    });
    if (!application) return;
    if (application.externalId != null && application.externalId !== externalId)
      throw new Error("panda company external id mismatch");
    return application;
  }
  function getCompanyUsers(companyId: string, filter?: { email: string }) {
    return request(
      array(
        object({
          companyId: optional(string()),
          email: optional(string()),
          id: string(),
          walletAddress: optional(string()),
        }),
      ),
      "user",
      client.get("/users", { query: { companyId, ...filter } }),
    );
  }
  async function getApplicationStatus(applicationId: string) {
    return request(ApplicationStatusResponse, "application", client.applications.user.retrieve(applicationId));
  }
  async function getCard(cardId: string) {
    return await request(CardResponse, "card", client.cards.retrieve(cardId));
  }
  async function getCards(userId: string) {
    return await request(CardsResponse, "card", client.cards.list({ userId, limit: 100 }));
  }
  async function getContracts() {
    return await request(
      array(
        object({ chainId: number(), contractVersion: number(), controllerAddress: Address, proxyAddress: Address }),
      ),
      "tenant",
      client.get("/tenants/contracts"),
    );
  }
  function getNonce(userId: string) {
    return request(object({ nonce: string() }), "user", client.get(`/users/${userId}/signatures/generate-nonce`));
  }
  async function getPIN(cardId: string, sessionId: string) {
    try {
      return await request(PINResponse, "card", client.cards.pin.retrieve(cardId, { SessionId: sessionId }));
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
      "card",
      client.get(`/cards/${cardId}/processorDetails`),
    );
  }
  async function getSecrets(cardId: string, sessionId: string) {
    return await request(PANResponse, "card", client.cards.retrieveSecrets(cardId, { SessionId: sessionId }));
  }
  async function getUser(userId: string) {
    return await request(UserResponse, "user", client.users.retrieve(userId));
  }
  async function getWebhook(id: string) {
    return await request(
      object({
        id: string(),
        requestBody: Payload,
        requestSentAt: pipe(string(), isoTimestamp()),
        responseReceivedAt: optional(pipe(string(), isoTimestamp())),
      }),
      "webhook",
      client.get(`/webhooks/${id}`),
    );
  }
  async function getWithdrawal(amount: number, recipient: Address, admin: Address) {
    return await request(
      Withdrawal,
      "tenant",
      client.get("/tenants/signatures/withdrawals", {
        query: {
          token: parse(Address, chain.testnet ? "0x29684075a3C86ea11D9964BcAf0F956e801396bD" : usdcAddress),
          amount,
          recipientAddress: recipient,
          adminAddress: admin,
          chainId: chain.id,
        },
      }),
    );
  }
  async function setPIN(cardId: string, sessionId: string, pin: { data: string; iv: string }) {
    return await request(
      object({}),
      "card",
      client.cards.pin.update(cardId, { SessionId: sessionId, encryptedPin: pin }),
    );
  }
  async function submitApplication(payload: InferInput<typeof SubmitApplicationRequest>) {
    return request(
      ApplicationResponse,
      "application",
      client.post("/applications/user", {
        body: payload,
        headers: { ...("ciphertext" in payload && { encrypted: "true" }) },
      }),
    );
  }
  async function updateApplication(applicationId: string, payload: InferInput<typeof UpdateApplicationRequest>) {
    return request(object({}), "application", client.patch(`/applications/user/${applicationId}`, { body: payload }));
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
    return await request(CardResponse, "card", client.patch(`/cards/${card.id}`, { body: card }));
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
    return await request(UserResponse, "user", client.patch(`/users/${user.id}`, { body: user }));
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
    return request(object({}), "user", client.put(`/users/${userId}/signatures/verify`, { body: payload }));
  }
}

async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  entity: string,
  response: { asResponse: () => Promise<Response> },
) {
  try {
    const body = await response.asResponse().then((raw) => raw.text());
    return parse(schema, body ? JSON.parse(body) : {});
  } catch (error) {
    if (!(error instanceof APIError) || typeof error.status !== "number") throw error;
    const raw = error.error === undefined ? error.message : JSON.stringify(error.error);
    let type: string | undefined;
    let message = raw;
    if (typeof error.error === "object" && error.error !== null) {
      const { error: kind, message: detail } = error.error as { error?: unknown; message?: unknown };
      if (typeof kind === "string") type = kind;
      if (typeof detail === "string") message = detail;
    }
    if (!type || (error.status === 404 && type === "Not Found")) {
      if (error instanceof NotFoundError) type = "NotFoundError";
      if (error instanceof PermissionDeniedError && raw.toLowerCase().includes("not approved")) type = "ForbiddenError";
    }
    if (message === "Not Found") message = entity;
    throw new ServiceError("Panda", error.status, raw, type, message);
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
    cardType: picklist(["physical", "virtual"]),
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
      type: picklist(["physical", "virtual"]),
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

export const Payload = variant("resource", [
  Transaction,
  Card,
  object({
    resource: literal("dispute"),
    action: string(),
    body: looseObject({ id: string() }),
    id: string(),
  }),
  object({
    resource: literal("company"),
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

const regions = new Intl.DisplayNames(["en"], { type: "region" });

const latin = regex(/^[\d a-z.,#'/&()°-]+$/i, "only latin letters, numbers and basic punctuation");

export const Shipping = strictObject({
  displayName: optional(pipe(string(), minLength(1), maxLength(26), regex(/^[\d a-z.-]+$/i))),
  line1: pipe(string(), minLength(1), maxLength(100), latin),
  line2: optional(pipe(string(), minLength(1), maxLength(100), latin)),
  city: pipe(string(), minLength(1), maxLength(50), latin),
  region: pipe(string(), minLength(1), maxLength(50), latin),
  postalCode: pipe(string(), minLength(1), maxLength(9), regex(/^[\d a-z-]+$/i)),
  countryCode: pipe(string(), regex(/^[A-Z]{2}$/)),
  phoneNumber: pipe(string(), regex(/^\+[1-9]\d{1,14}$/)),
});

const BaseCardRequest = object({
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
});

const CreateCardRequest = variant("type", [
  object({
    type: literal("virtual"),
    ...BaseCardRequest.entries,
    configuration: object({
      productId: picklist([BASE_PRODUCT_ID, CLASSIC_PRODUCT_ID, PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID]),
      virtualCardArt: string(),
    }),
  }),
  object({
    type: literal("physical"),
    ...BaseCardRequest.entries,
    configuration: object({
      productId: literal(PHYSICAL_SIGNATURE_PRODUCT_ID),
      displayName: Shipping.entries.displayName,
    }),
    shipping: object({
      ...omit(Shipping, ["displayName"]).entries,
      country: string(),
      method: picklist(["standard", "express", "international"]),
    }),
  }),
]);

const CardResponse = object({
  id: string(),
  userId: string(),
  type: picklist(["physical", "virtual"]),
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

const CardsResponse = array(
  object({
    id: string(),
    type: picklist(["physical", "virtual"]),
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
  phoneCountryCode: optional(string()),
  phoneNumber: optional(string()),
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

export const partner = "5lu2sNu0v0ZElC2m77QR3rAZBHLr8PoG"; // cspell:ignore azbh

export function collectors(id: number = chain.id): [Address] {
  return [parse(Address, (accounts.collector as Partial<Record<number, string>>)[id] ?? accounts.collector.default)];
}

export function declineMessage(reason?: null | string) {
  return reason
    ? ({
        "account credit limit exceeded": "transaction declined",
        "bad collection": "transaction declined",
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
        "frozen card": "frozen card",
        insufficientaccountliquidity: "insufficient funds", // cspell:ignore insufficientaccountliquidity
        insufficient_funds: "insufficient funds",
        "invalid pin": "invalid pin",
        "invalid pin attempt limit exceeded": "too many invalid pin attempts",
        merchant_blocked: "this merchant is not accepted",
        "triggers for transactions from mcc 6050 and 6051": "this merchant is not accepted",
        "unexpected error": "transaction declined",
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
  verifyingContract: Hex = issuerCheckerAddress,
  chainId: number = chain.id,
) {
  return issuer.signTypedData({
    domain: { chainId, name: "IssuerChecker", version: "1", verifyingContract },
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
export class BusinessApplicationError extends Error {
  constructor(
    message: string,
    readonly code: "bad kyb" | "bad request" | "not started" | "processing",
  ) {
    super(message);
  }
}

const mutexes = new Map<Address, MutexInterface>();
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

const BirthDate = pipe(
  string(),
  regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD format"),
  check((value) => {
    const date = new Date(value);
    return !Number.isNaN(date.getTime());
  }, "must be a valid date"),
);

const CorporatePerson = object({
  address: AddressSchema,
  birthDate: BirthDate,
  countryOfIssue: pipe(string(), length(2), regex(/^[A-Z]{2}$/i)),
  email: pipe(string(), email()),
  firstName: pipe(string(), trim(), nonEmpty(), maxLength(50)),
  lastName: pipe(string(), trim(), nonEmpty(), maxLength(50)),
  nationalId: pipe(string(), trim(), nonEmpty(), maxLength(50)),
});

const CreateCompanyApplicationRequest = object({
  address: AddressSchema,
  entity: object({
    description: pipe(string(), trim(), nonEmpty(), maxLength(500)),
    industry: pipe(string(), regex(/^\d{6}$/)),
    name: pipe(string(), trim(), nonEmpty(), maxLength(100)),
    registrationNumber: pipe(string(), trim(), nonEmpty(), maxLength(100)),
    taxId: pipe(string(), trim(), nonEmpty(), maxLength(100)),
    website: pipe(string(), trim(), nonEmpty(), maxLength(255), urlValidator()),
  }),
  externalId: string(),
  initialUser: object({
    ...CorporatePerson.entries,
    ipAddress: pipe(string(), maxLength(50), ip()),
    walletAddress: Address,
  }),
  name: pipe(string(), trim(), nonEmpty(), maxLength(100)),
  representatives: array(CorporatePerson),
  sourceKey: string(),
  ultimateBeneficialOwners: array(CorporatePerson),
});

const CreateCompanyUserRequest = object({
  address: optional(AddressSchema),
  birthDate: optional(BirthDate),
  email: pipe(string(), email()),
  externalId: optional(pipe(string(), minLength(1), maxLength(255))),
  firstName: pipe(string(), trim(), nonEmpty(), maxLength(50)),
  lastName: pipe(string(), trim(), nonEmpty(), maxLength(50)),
  phoneCountryCode: optional(string()),
  phoneNumber: optional(string()),
  solanaAddress: optional(pipe(string(), regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/))),
  walletAddress: optional(Address),
});

type Owner = InferInput<typeof CorporatePerson>;

const ApplicationLink = object({
  params: object({ signature: string(), userId: pipe(string(), uuid()) }),
  url: pipe(string(), urlValidator()),
});
const ApplicationReview = {
  applicationCompletionLink: optional(nullable(ApplicationLink)),
  applicationExternalVerificationLink: optional(nullable(ApplicationLink)),
  applicationReason: optional(nullable(string())),
};

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

const CompanyApplicationStatusResponse = object({
  ...ApplicationReview,
  applicationStatus: optional(nullable(picklist(kycStatus))),
  externalId: optional(nullable(string())),
  id: string(),
});

const CompanyApplicationResponse = object({
  ...CompanyApplicationStatusResponse.entries,
  address: AddressSchema,
  name: string(),
  sourceKey: optional(nullable(string())),
  ultimateBeneficialOwners: optional(nullable(array(object({ ...ApplicationReview, id: string() })))),
});

const CompanyUserResponse = object({
  address: nullish(
    object({
      city: string(),
      country: nullish(string()),
      countryCode: string(),
      line1: string(),
      line2: nullish(string()),
      postalCode: string(),
      region: string(),
    }),
  ),
  applicationCompletionLink: nullish(
    object({
      params: object({ signature: string(), userId: pipe(string(), uuid()) }),
      url: pipe(string(), urlValidator()),
    }),
  ),
  applicationExternalVerificationLink: nullish(
    object({
      params: object({ signature: string(), userId: pipe(string(), uuid()) }),
      url: pipe(string(), urlValidator()),
    }),
  ),
  applicationReason: nullish(string()),
  applicationStatus: picklist([
    "approved",
    "pending",
    "needsInformation",
    "needsVerification",
    "manualReview",
    "denied",
    "locked",
    "canceled",
    "notStarted",
    "tosNotAccepted",
  ]),
  companyId: nullish(pipe(string(), uuid())),
  createdAt: nullish(pipe(string(), isoTimestamp())),
  email: string(),
  externalId: nullish(string()),
  firstName: string(),
  id: pipe(string(), uuid()),
  isActive: boolean(),
  lastName: string(),
  phoneCountryCode: nullish(string()),
  phoneNumber: nullish(string()),
  solanaAddress: nullish(string()),
  sourceKey: nullish(string()),
  updatedAt: nullish(pipe(string(), isoTimestamp())),
  walletAddress: nullish(string()),
});

export const Application = object({
  email: pipe(
    string(),
    email("Invalid email address"),
    metadata({ description: "Email address", examples: ["user@domain.com"] }),
  ),
  lastName: pipe(string(), maxLength(50), metadata({ description: "The person's last name" })),
  firstName: pipe(string(), maxLength(50), metadata({ description: "The person's first name" })),
  nationalId: pipe(string(), maxLength(50), metadata({ description: "The person's national ID" })),
  birthDate: pipe(BirthDate, metadata({ description: "Birth date (YYYY-MM-DD)", examples: ["1970-01-01"] })),
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
