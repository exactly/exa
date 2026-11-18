import { SignJWT } from "jose";

import { business } from "@exactly/common/tenants";

import type { Address } from "@exactly/common/validation";

export default function intercom(secret: string) {
  return async function token(userId: string, expires: Date | number, salt: Address) {
    return await new SignJWT({ sub: userId, user_id: userId, ...(salt === business && { exa_profile: "business" }) })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(Math.floor((expires instanceof Date ? expires.getTime() : expires) / 1000))
      .sign(new TextEncoder().encode(secret));
  };
}
