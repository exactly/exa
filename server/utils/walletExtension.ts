import { jwtVerify, SignJWT } from "jose";
import { literal, object, parse, string } from "valibot";

import authSecret from "./authSecret";

const key = new TextEncoder().encode(authSecret);

export function createToken(credentialId: string, expires: number) {
  return new SignJWT({ credentialId, scope: "card:provisioning" })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("wallet-extension")
    .setIssuedAt()
    .setExpirationTime(Math.floor(expires / 1000))
    .sign(key);
}

export async function verifyToken(token: string) {
  return jwtVerify(token, key, { audience: "wallet-extension" })
    .then(({ payload }) => parse(object({ credentialId: string(), scope: literal("card:provisioning") }), payload))
    .catch(() => null);
}
