import { SignJWT } from "jose";

export default function intercom(secret: string) {
  return async function token(userId: string, expires: Date | number) {
    return await new SignJWT({ sub: userId, user_id: userId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(Math.floor((expires instanceof Date ? expires.getTime() : expires) / 1000))
      .sign(new TextEncoder().encode(secret));
  };
}
