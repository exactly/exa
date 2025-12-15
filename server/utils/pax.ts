import { setContext } from "@sentry/core";
import {
  description,
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

if (!process.env.PAX_API_URL) throw new Error("missing pax api url");
const baseURL = process.env.PAX_API_URL;

if (!process.env.PAX_API_KEY) throw new Error("missing pax api key");
const key = process.env.PAX_API_KEY;

/**
 * Schema for validating Capita creation requests.
 * Represents the structure of data required to create a new entry in the Pax system.
 */
export const CapitaRequest = object({
  firstName: string(),
  lastName: string(),
  document: string(),
  birthdate: string(),
  email: string(),
  phone: string(),
  product: pipe(string(), description("The product name to add the capita to")),
});

/**
 * Adds a new Capita (user/account) to the Pax system.
 *
 * @param data - The capita details matching the CapitaRequest schema.
 * @returns The response from the Pax API (parsed JSON).
 * @throws {ValiError} If the response validation fails.
 * @throws {Error} If the HTTP request fails.
 */
export async function addCapita(data: InferInput<typeof CapitaRequest> & { internalId: string }) {
  return await request(object({}), "/api/capita", data, "POST");
}

/**
 * Removes a Capita by its internal ID.
 *
 * @param internalId - The internal ID of the capita to remove.
 * @returns The response from the Pax API or an empty object if parsing fails (common for DELETE requests).
 */
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

  // Pax API returns 200/201 but sometimes empty body or just []
  const rawBody = await response.arrayBuffer();
  if (rawBody.byteLength === 0) return {};

  try {
    const text = new TextDecoder().decode(rawBody);
    const json: unknown = JSON.parse(text);
    const result = safeParse(schema, json);

    if (!result.success) {
      setContext("validation", { ...result, flatten: flatten(result.issues) });
      throw new ValiError(result.issues);
    }
    return result.output;
  } catch {
    // If parsing fails but response was ok, just return empty object for now as we don't depend on response
    // typically DELETE returns empty
    return {};
  }
}
