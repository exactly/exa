import createDebug from "debug";
import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash } from "node:crypto";

if (!process.env.CHAT_IDENTITY_KEY) throw new Error("missing chat key");
const key = createHash("sha256").update(process.env.CHAT_IDENTITY_KEY).digest();
const debug = createDebug("exa:chat");

const audience = "chat-whatsapp";
const issuer = "chat-webhook";

export async function encode(subject: string, expiration: Date | number | string = "1h") {
  return new EncryptJWT({})
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setSubject(subject)
    .setAudience(audience)
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(expiration)
    .encrypt(key);
}

export async function decode(token: string) {
  const { payload } = await jwtDecrypt(token, key, {
    audience,
    issuer,
    keyManagementAlgorithms: ["dir"],
    contentEncryptionAlgorithms: ["A256GCM"],
  });
  if (!payload.sub) throw new Error("missing subject");
  return payload.sub;
}

export function sendCode(waId: string, code: string) {
  // TODO integrate message senders
  debug("send validation code %s to %s", code, waId);
  return Promise.resolve();
}
