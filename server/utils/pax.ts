import { captureException, setContext } from "@sentry/node";
import { env } from "node:process";
import { flatten, object, safeParse, ValiError, type BaseIssue, type BaseSchema } from "valibot";
import { encodePacked, keccak256 } from "viem";

import ServiceError from "./ServiceError";

import type { Address } from "@exactly/common/validation";

const ASSOCIATE_ID_LENGTH = 10;

export default function pax({ associateKey, key, url }: { associateKey: string; key: string; url: string }) {
  const client = { key, url };
  return {
    addCapita: (data: Parameters<typeof addCapita>[0]) => addCapita(data, client),
    deriveAssociateId: (account: Address) => deriveAssociateId(account, associateKey),
  };
}

export async function addCapita(
  data: {
    birthdate: string;
    document: string;
    email: string;
    firstName: string;
    internalId: string;
    lastName: string;
    phone: string;
    product: string;
  },
  client = getDefaultClient(),
) {
  return await request(object({}), "/api/capita", data, "POST", 10_000, client);
}

export async function removeCapita(internalId: string): Promise<void> {
  await request(object({}), `/api/capita/${internalId}`, undefined, "DELETE");
}

async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  url: string,
  body?: unknown,
  method: "DELETE" | "GET" | "POST" | "PUT" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
  client = getDefaultClient(),
) {
  const response = await fetch(`${client.url}${url}`, {
    method,
    headers: {
      "x-api-key": client.key,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) throw new ServiceError("Pax", response.status, await response.text());

  const rawBody = await response.arrayBuffer();
  if (rawBody.byteLength === 0) return {};

  let json: unknown;
  try {
    const text = new TextDecoder().decode(rawBody);
    json = JSON.parse(text);
  } catch (error) {
    captureException(error);
    throw new Error("failed to parse pax response");
  }

  const result = safeParse(schema, json);
  if (!result.success) {
    setContext("validation", { ...result, flatten: flatten(result.issues) });
    throw new ValiError(result.issues);
  }
  return result.output;
}

export function deriveAssociateId(account: Address, associateKey = getAssociateKey()): string {
  const hash = keccak256(encodePacked(["address", "string"], [account, associateKey]));
  return BigInt(hash).toString(36).slice(0, ASSOCIATE_ID_LENGTH);
}

function getDefaultClient(): Client {
  if (!env.PAX_API_URL) throw new Error("missing pax api url");
  if (!env.PAX_API_KEY) throw new Error("missing pax api key");
  return { key: env.PAX_API_KEY, url: env.PAX_API_URL };
}

function getAssociateKey() {
  if (!env.PAX_ASSOCIATE_ID_KEY) throw new Error("missing pax associate id secret");
  return env.PAX_ASSOCIATE_ID_KEY;
}

type Client = { key: string; url: string };
