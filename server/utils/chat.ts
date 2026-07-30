import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash } from "node:crypto";
import { object, parse, type BaseIssue, type BaseSchema } from "valibot";

import ServiceError from "./ServiceError";

export default function chat({ from, key, token }: { from: string; key: string; token: string }) {
  return { decode, encode, send };

  function encode(subject: string, expiration: Date | number | string = "1h") {
    return new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setSubject(subject)
      .setAudience(audience)
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime(expiration)
      .encrypt(createHash("sha256").update(key).digest());
  }

  async function decode(jwt: string) {
    const { payload } = await jwtDecrypt(jwt, createHash("sha256").update(key).digest(), {
      audience,
      issuer,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    if (!payload.sub) throw new Error("missing subject");
    return payload.sub;
  }

  async function send(recipient: string, text: string) {
    await request(object({}), `/${from}/messages`, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      recipient,
      type: "text",
      text: { body: text },
    });
  }

  async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
    schema: BaseSchema<TInput, TOutput, TIssue>,
    path: `/${string}`,
    body?: unknown,
    method: "DELETE" | "GET" | "POST" = body === undefined ? "GET" : "POST",
    timeout = 10_000,
  ) {
    const response = await fetch(`https://graph.facebook.com/v26.0${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new ServiceError("WhatsApp", response.status, await response.text());
    const raw = await response.arrayBuffer();
    if (raw.byteLength === 0) return parse(schema, {});
    return parse(schema, JSON.parse(new TextDecoder().decode(raw)));
  }
}

const audience = "chat-whatsapp";
const issuer = "chat-webhook";
