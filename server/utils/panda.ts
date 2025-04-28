import domain from "@exactly/common/domain";
import chain, { exaAccountFactoryAddress, exaPluginAddress } from "@exactly/common/generated/chain";
import { Address, Hash } from "@exactly/common/validation";
import { proposalManager } from "@exactly/plugin/deploy.json";
import { vValidator } from "@hono/valibot-validator";
import { Mutex, withTimeout, type MutexInterface } from "async-mutex";
import { eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import removeAccents from "remove-accents";
import {
  type BaseIssue,
  type BaseSchema,
  length,
  literal,
  maxLength,
  minLength,
  number,
  object,
  parse,
  picklist,
  pipe,
  string,
} from "valibot";
import { BaseError, ContractFunctionZeroDataError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { optimism } from "viem/chains";

import database, { credentials } from "../database";
import { issuerCheckerAddress, upgradeableModularAccountAbi } from "../generated/contracts";
import publicClient from "../utils/publicClient";

const plugin = exaPluginAddress.toLowerCase();

if (!process.env.PANDA_API_URL) throw new Error("missing panda api url");
const baseURL = process.env.PANDA_API_URL;

if (!process.env.PANDA_API_KEY) throw new Error("missing panda api key");
const key = process.env.PANDA_API_KEY;
export default key;

export function displayName({ first, middle, last }: { first: string; middle: string | null; last: string }) {
  let cardholder = [first, middle, last].filter(Boolean).join(" ");
  if (cardholder.length > 30 && middle) cardholder = `${first} ${last}`;
  return removeAccents(cardholder.slice(0, 30));
}

export async function createCard({
  userId,
  name,
}: {
  userId: string;
  name: { first: string; middle: string | null; last: string };
}) {
  return await request(
    CardResponse,
    `/issuing/users/${userId}/cards`,
    {},
    parse(CreateCardRequest, {
      type: "virtual",
      status: "active",
      limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
      configuration: {
        displayName: displayName(name),
        virtualCardArt:
          { "web.exactly.app": "81e42f27affd4e328f19651d4f2b438e" }[domain] ?? "0c515d7eb0a140fa8f938f8242b0780a",
      },
    }),
    "POST",
  );
}

export async function createUser(user: {
  accountPurpose: string;
  annualSalary: string;
  expectedMonthlyVolume: string;
  isTermsOfServiceAccepted: true;
  ipAddress: string;
  occupation: string;
  personaShareToken: string;
}) {
  return await request(object({ id: string() }), "/issuing/applications/user", {}, user, "POST");
}

export async function getCard(cardId: string) {
  return await request(CardResponse, `/issuing/cards/${cardId}`);
}

export async function getSecrets(cardId: string, sessionId: string) {
  return await request(PANResponse, `/issuing/cards/${cardId}/secrets`, { SessionId: sessionId });
}

async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  url: `/${string}`,
  headers = {},
  body?: unknown,
  method: "GET" | "POST" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
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
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return parse(schema, await response.json());
}

const PANResponse = object({
  encryptedPan: object({ iv: string(), data: string() }),
  encryptedCvc: object({ iv: string(), data: string() }),
});

const CreateCardRequest = object({
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
  configuration: object({ displayName: pipe(string(), maxLength(30)), virtualCardArt: string() }),
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
      if (!credential) throw new Error("credential not found");
      return credential.factory === exaAccountFactoryAddress;
    }
    throw error;
  }
}

export function headerValidator() {
  return vValidator("header", object({ signature: string() }), async (r, c) => {
    if (!r.success) return c.text("bad request", 400);
    return r.output.signature ===
      createHmac("sha256", key)
        .update(Buffer.from(await c.req.arrayBuffer()))
        .digest("hex")
      ? undefined
      : c.text("unauthorized", 401);
  });
}

export const collectors: Address[] = (
  {
    [optimism.id]: ["0x3a73880ff21ABf9cA9F80B293570a3cBD846eFc5"],
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
  const mutex = withTimeout(new Mutex(), proposalManager.delay * 1000);
  mutexes.set(address, mutex);
  return mutex;
}
export function getMutex(address: Address) {
  return mutexes.get(address);
}
