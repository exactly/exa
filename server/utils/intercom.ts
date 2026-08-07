import { SignJWT } from "jose";

export default function intercom(secret: string) {
  return (userId: string, expires: Date | number) => getToken(userId, expires, secret);
}

async function getToken(userId: string, expires: Date | number, secret: string) {
  return await new SignJWT({ sub: userId, user_id: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor((expires instanceof Date ? expires.getTime() : expires) / 1000))
    .sign(new TextEncoder().encode(secret));
}
