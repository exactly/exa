import { vValidator } from "@hono/valibot-validator";
import { Mutex, withTimeout, type MutexInterface } from "async-mutex";
import {
  array,
  boolean,
  check,
  digits,
  email,
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
  regex,
  string,
  transform,
  tuple,
  union,
  variant,
  type BaseIssue,
  type BaseSchema,
  type InferInput,
} from "valibot";
import { recoverTypedDataAddress, type LocalAccount } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain, {
  issuerCheckerAddress,
  marketUSDCAddress,
  previewerAbi,
  previewerAddress,
  usdcAddress,
} from "@exactly/common/generated/chain";
import { BASE_PRODUCT_ID, PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { Address, Hex } from "@exactly/common/validation";
import { proposalManager } from "@exactly/plugin/deploy.json";

import publicClient from "./publicClient";
import ServiceError from "./ServiceError";
import verifySignature from "./verifySignature";

export default function panda({ key, url }: { key: string; url: string }) {
  return {
    createCard,
    createUser,
    getApplicationStatus,
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
  };

  async function createCard(
    userId: string,
    productId: typeof BASE_PRODUCT_ID | typeof PLATINUM_PRODUCT_ID | typeof SIGNATURE_PRODUCT_ID,
    amount = 1_000_000,
  ) {
    return await request(
      CardResponse,
      `/issuing/users/${userId}/cards`,
      {},
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
          statement: string;
        }
      | { authType: "siwe"; message: string; signature: string },
  ) {
    return request(object({}), `/issuing/users/${userId}/signatures/verify`, {}, payload, "PUT", 10_000);
  }
}

export async function autoCredit(account: Address) {
  const markets = await publicClient.readContract({
    address: previewerAddress,
    functionName: "exactly",
    abi: previewerAbi,
    args: [account],
  });
  let hasCollateral = false;
  for (const { floatingDepositAssets, market } of markets) {
    if (floatingDepositAssets > 0n) {
      if (market === marketUSDCAddress) return false;
      hasCollateral = true;
    }
  }
  return hasCollateral;
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

const ApplicationStatusResponse = object({
  id: string(),
  applicationStatus: picklist(kycStatus),
  applicationReason: optional(string()),
});
