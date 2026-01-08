import type { Address } from "@exactly/common/validation";
import { captureException, setContext } from "@sentry/node";
import {
  description,
  email,
  flatten,
  object,
  pipe,
  safeParse,
  string,
  ValiError,
  type BaseIssue,
  type BaseSchema,
  type InferInput,
} from "valibot";
import { encodePacked, keccak256 } from "viem";

if (!process.env.PAX_API_URL) throw new Error("missing pax api url");
const baseURL = process.env.PAX_API_URL;

if (!process.env.PAX_API_KEY) throw new Error("missing pax api key");
const key = process.env.PAX_API_KEY;

if (!process.env.PAX_ASSOCIATE_ID_KEY) throw new Error("missing pax associate id secret");
const associateIdSecret = process.env.PAX_ASSOCIATE_ID_KEY;

const ASSOCIATE_ID_LENGTH = 10;

export const CapitaRequest = object({
  firstName: string(),
  lastName: string(),
  document: string(),
  birthdate: string(),
  email: pipe(string(), email()),
  phone: string(),
  product: pipe(string(), description("the product name to add the capita to")),
});

export async function addCapita(data: InferInput<typeof CapitaRequest> & { internalId: string }) {
  return await request(object({}), "/api/capita", data, "POST");
}

export async function removeCapita(internalId: string) {
  return await request(object({}), `/api/capita/${internalId}`, undefined, "DELETE");
}

async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  url: string,
  body?: unknown,
  method: "GET" | "POST" | "PUT" | "DELETE" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
) {
  const response = await fetch(`${baseURL}${url}`, {
    method,
    headers: {
      "x-api-key": key,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);

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

export function deriveAssociateId(account: Address): string {
  const hash = keccak256(encodePacked(["address", "string"], [account, associateIdSecret]));
  return BigInt(hash).toString(36).slice(0, ASSOCIATE_ID_LENGTH);
}
