import { UnrecoverableError } from "bullmq";
import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash } from "node:crypto";
import { boolean, object, optional, safeParse, string } from "valibot";

import ServiceError from "./ServiceError";

export default function whatsapp({ from, key, token }: { from: string; key: string; token: string }) {
  const secret = createHash("sha256").update(key).digest();
  return { decode, encode, send };

  function encode(subject: string, expiration: Date | number | string = "1h") {
    return new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setSubject(subject)
      .setAudience(audience)
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime(expiration)
      .encrypt(secret);
  }

  async function decode(jwt: string) {
    const { payload } = await jwtDecrypt(jwt, secret, {
      audience,
      issuer,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    if (!payload.sub) throw new Error("missing subject");
    return payload.sub;
  }

  async function send(recipient: string, text: string) {
    const response = await fetch(`https://graph.facebook.com/v26.0/${from}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        recipient,
        type: "text",
        text: { body: text },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await response.text();
    if (response.ok) return;
    let input: unknown = raw;
    try {
      input = JSON.parse(raw) as unknown;
    } catch {} // eslint-disable-line no-empty -- non-json graph errors use status classification
    const parsed = safeParse(GraphError, input);
    const failure = parsed.success ? parsed.output.error : undefined;
    const error = new ServiceError("WhatsApp", response.status, raw, failure?.type, failure?.message);
    if (response.status >= 500 || failure?.is_transient === true) throw error;
    throw Object.assign(new UnrecoverableError(error.message), { cause: error });
  }
}

const GraphError = object({
  error: object({ is_transient: optional(boolean()), message: string(), type: string() }),
});
const audience = "chat-whatsapp";
const issuer = "chat-webhook";
