import { captureException, setContext } from "@sentry/node";
import { flatten, object, safeParse, ValiError, type BaseIssue, type BaseSchema } from "valibot";
import { encodePacked, keccak256 } from "viem";

import ServiceError from "./ServiceError";

import type { Address } from "@exactly/common/validation";

const ASSOCIATE_ID_LENGTH = 10;

export default function pax({ associateKey, key, url }: { associateKey: string; key: string; url: string }) {
  return { addCapita, deriveAssociateId, removeCapita };

  async function addCapita(data: {
    birthdate: string;
    document: string;
    email: string;
    firstName: string;
    internalId: string;
    lastName: string;
    phone: string;
    product: string;
  }) {
    return await request(object({}), "/api/capita", data, "POST", 10_000);
  }

  async function removeCapita(internalId: string): Promise<void> {
    await request(object({}), `/api/capita/${internalId}`, undefined, "DELETE");
  }

  function deriveAssociateId(account: Address): string {
    const hash = keccak256(encodePacked(["address", "string"], [account, associateKey]));
    return BigInt(hash).toString(36).slice(0, ASSOCIATE_ID_LENGTH);
  }

  async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
    schema: BaseSchema<TInput, TOutput, TIssue>,
    path: string,
    body?: unknown,
    method: "DELETE" | "GET" | "POST" | "PUT" = body === undefined ? "GET" : "POST",
    timeout = 10_000,
  ) {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: { "x-api-key": key, "content-type": "application/json" },
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
}
