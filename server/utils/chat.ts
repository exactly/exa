import createDebug from "debug";
import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash } from "node:crypto";

const audience = "chat-whatsapp";
const issuer = "chat-webhook";
const debug = createDebug("exa:chat");

export default function createChat(secret: string) {
  const key = createHash("sha256").update(secret).digest();
  return {
    encode: async (subject: string, expiration: Date | number | string = "1h") =>
      new EncryptJWT({})
        .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
        .setSubject(subject)
        .setAudience(audience)
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime(expiration)
        .encrypt(key),
    decode: async (token: string) => {
      const { payload } = await jwtDecrypt(token, key, {
        audience,
        issuer,
        keyManagementAlgorithms: ["dir"],
        contentEncryptionAlgorithms: ["A256GCM"],
      });
      if (!payload.sub) throw new Error("missing subject");
      return payload.sub;
    },
  };
}

export function sendCode(whatsappId: string, code: string) {
  // TODO integrate message senders
  debug("send validation code %s to %s", code, whatsappId);
  return Promise.resolve();
}
