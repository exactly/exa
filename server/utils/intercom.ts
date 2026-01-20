import { SignJWT } from "jose";

if (!process.env.INTERCOM_IDENTITY_KEY) throw new Error("missing intercom key");
const intercomSecret = process.env.INTERCOM_IDENTITY_KEY;

export default async function getToken(userId: string, expires: Date | number) {
  return await new SignJWT({ sub: userId, user_id: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor((expires instanceof Date ? expires.getTime() : expires) / 1000))
    .sign(Buffer.from(intercomSecret, "base64"));
}
