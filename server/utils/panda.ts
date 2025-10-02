import { vValidator } from "@hono/valibot-validator";
import { Mutex, withTimeout, type MutexInterface } from "async-mutex";
import { eq } from "drizzle-orm";
import {
  boolean,
  check,
  email,
  ipv4,
  ipv6,
  length,
  literal,
  maxLength,
  metadata,
  minLength,
  nullable,
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
  union,
  type BaseIssue,
  type BaseSchema,
  type InferInput,
} from "valibot";
import { BaseError, ContractFunctionZeroDataError, type MaybePromise } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, optimism } from "viem/chains";

import chain, {
  exaAccountFactoryAddress,
  exaPluginAddress,
  issuerCheckerAddress,
  marketUSDCAddress,
  previewerAbi,
  previewerAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { Address, Hash, Hex } from "@exactly/common/validation";
import { proposalManager } from "@exactly/plugin/deploy.json";

import verifySignature from "./verifySignature";
import database, { credentials } from "../database";
import publicClient from "../utils/publicClient";

const plugin = exaPluginAddress.toLowerCase();

if (!process.env.PANDA_API_URL) throw new Error("missing panda api url");
const baseURL = process.env.PANDA_API_URL;

if (!process.env.PANDA_API_KEY) throw new Error("missing panda api key");
const key = process.env.PANDA_API_KEY;

export async function createCard(userId: string, productId: typeof PLATINUM_PRODUCT_ID | typeof SIGNATURE_PRODUCT_ID) {
  return await request(
    CardResponse,
    `/issuing/users/${userId}/cards`,
    {},
    parse(CreateCardRequest, {
      type: "virtual",
      status: "active",
      limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
      configuration: {
        productId,
        virtualCardArt: {
          [PLATINUM_PRODUCT_ID]: "81e42f27affd4e328f19651d4f2b438e",
          [SIGNATURE_PRODUCT_ID]: "398c4919514b4ec4927e6a9114a4c816",
        }[productId],
      },
    }),
    "POST",
  );
}

export async function createUser(user: {
  accountPurpose: string;
  annualSalary: string;
  expectedMonthlyVolume: string;
  ipAddress: string;
  isTermsOfServiceAccepted: true;
  occupation: string;
  personaShareToken: string;
}) {
  return await request(object({ id: string() }), "/issuing/applications/user", {}, user, "POST");
}

export async function updateUser(user: {
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
  return await request(UserResponse, `/issuing/users/${user.id}`, {}, user, "PATCH");
}

export async function getUser(userId: string) {
  return await request(UserResponse, `/issuing/users/${userId}`);
}

export async function getCard(cardId: string) {
  return await request(CardResponse, `/issuing/cards/${cardId}`);
}

export async function updateCard(card: {
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
  return await request(CardResponse, `/issuing/cards/${card.id}`, {}, card, "PATCH");
}

export async function getSecrets(cardId: string, sessionId: string) {
  return await request(PANResponse, `/issuing/cards/${cardId}/secrets`, { SessionId: sessionId });
}

export async function getPIN(cardId: string, sessionId: string) {
  try {
    return await request(PINResponse, `/issuing/cards/${cardId}/pin`, { SessionId: sessionId });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Failed to get PIN, card does not have PIN set")) {
      return parse(PINResponse, { encryptedPin: null });
    }
    throw error;
  }
}

export async function setPIN(cardId: string, sessionId: string, pin: { data: string; iv: string }) {
  return await request(
    object({}),
    `/issuing/cards/${cardId}/pin`,
    { SessionId: sessionId },
    { encryptedPin: pin },
    "PUT",
  );
}

async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  url: `/${string}`,
  headers = {},
  body?: unknown,
  method: "GET" | "PATCH" | "POST" | "PUT" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
  onError?: (response: Response) => MaybePromise<TOutput>,
) {
  const response = await fetch(`${baseURL}${url}`, {
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
    if (onError) return await onError(response);
    throw new Error(`${response.status} ${await response.text()}`);
  }
  const rawBody = await response.arrayBuffer();
  if (rawBody.byteLength === 0) return parse(schema, {});
  return parse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
}

const PANResponse = object({
  encryptedPan: object({ iv: string(), data: string() }),
  encryptedCvc: object({ iv: string(), data: string() }),
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
  configuration: object({ productId: picklist([PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID]), virtualCardArt: string() }),
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

export async function isPanda(account: Address) {
  try {
    const installedPlugins = await publicClient.readContract({
      address: account,
      functionName: "getInstalledPlugins",
      abi: upgradeableModularAccountAbi,
    });
    return installedPlugins.some((addr) => plugin === addr.toLowerCase());
  } catch (error) {
    if (error instanceof BaseError && error.cause instanceof ContractFunctionZeroDataError) {
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.account, account),
        columns: { factory: true },
      });
      if (!credential) throw new Error("no credential");
      return credential.factory === exaAccountFactoryAddress;
    }
    throw error;
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

export function headerValidator() {
  return vValidator("header", object({ signature: string() }), async (r, c) => {
    if (!r.success) return c.text("bad request", 400);
    const payload = await c.req.arrayBuffer();
    if (verifySignature({ signature: r.output.signature, signingKey: key, payload })) return;
    return c.text("unauthorized", 401);
  });
}

export const collectors: Address[] = (
  {
    [optimism.id]: ["0x3a73880ff21ABf9cA9F80B293570a3cBD846eFc5"],
    [base.id]: ["0xaFFAc76bafE73d6F4e7f73E6d43b7CccC94d1813"],
  }[chain.id] ?? ["0xDb90CDB64CfF03f254e4015C4F705C3F3C834400"]
).map((address) => parse(Address, address));

// TODO remove code below
const issuer = privateKeyToAccount(parse(Hash, process.env.ISSUER_PRIVATE_KEY, { message: "invalid private key" }));
export function signIssuerOp({ account, amount, timestamp }: { account: Address; amount: bigint; timestamp: number }) {
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

export async function submitApplication(payload: InferInput<typeof SubmitApplicationRequest>, encrypted = false) {
  return request(
    ApplicationResponse,
    "/issuing/applications/user",
    { ...(encrypted && { encrypted: "true" }) },
    payload,
    "POST",
    10_000,
    async (response) => {
      const text = await response.text();
      try {
        const error = parse(object({ message: string() }), JSON.parse(text));
        throw new KycError(error.message, response.status);
      } catch (error) {
        if (error instanceof KycError) throw error;
        throw new Error(`${response.status} ${text}`);
      }
    },
  );
}

export async function getApplicationStatus(applicationId: string) {
  return request(
    ApplicationStatusResponse,
    `/issuing/applications/user/${applicationId}`,
    {},
    undefined,
    "GET",
    10_000,
    async (response) => {
      const text = await response.text();
      try {
        const error = parse(object({ message: string() }), JSON.parse(text));
        throw new KycError(error.message, response.status);
      } catch (error) {
        if (error instanceof KycError) throw error;
        throw new Error(`${response.status} ${text}`);
      }
    },
  );
}

export async function updateApplication(applicationId: string, payload: InferInput<typeof UpdateApplicationRequest>) {
  return request(
    object({}),
    `/issuing/applications/user/${applicationId}`,
    {},
    payload,
    "PATCH",
    10_000,
    async (response) => {
      const text = await response.text();
      try {
        const error = parse(object({ message: string() }), JSON.parse(text));
        throw new KycError(error.message, response.status);
      } catch (error) {
        if (error instanceof KycError) throw error;
        throw new Error(`${response.status} ${text}`);
      }
    },
  );
}

const AddressSchema = object({
  line1: pipe(string(), minLength(1), maxLength(100)),
  line2: optional(pipe(string(), minLength(1), maxLength(100))),
  city: pipe(string(), minLength(1), maxLength(50)),
  region: pipe(string(), minLength(1), maxLength(50)),
  country: optional(pipe(string(), minLength(1), maxLength(50))),
  postalCode: pipe(string(), minLength(1), maxLength(15), regex(/^[a-z0-9]{1,15}$/i)),
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
    metadata({ description: "The person's country of issue of their national id, as a 2-digit country code" }),
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
  verify: object({ message: string(), signature: Hex, walletAddress: Address, chainId: number() }),
});

export const SubmitApplicationRequest = union([
  Application,
  object({
    key: string(),
    iv: string(),
    ciphertext: string(),
    tag: string(),
    verify: object({ message: string(), signature: Hex, walletAddress: Address, chainId: number() }),
  }),
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

export class KycError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = "KycError";
  }
}

// #endregion schemas
