import { captureException } from "@sentry/node";
import { jwtVerify, SignJWT } from "jose";
import { createSecretKey } from "node:crypto";
import { literal, object, parse, string } from "valibot";

const { WALLET_EXTENSION_SECRET } = process.env;

if (!WALLET_EXTENSION_SECRET) throw new Error("missing wallet extension secret");

const key = createSecretKey(Buffer.from(WALLET_EXTENSION_SECRET, "utf8"));
if ((key.symmetricKeySize ?? 0) < 32) throw new Error("wallet extension secret too short for HS256");
const issuer = "exa-server";

export async function walletExtension(credentialId: string) {
  const expire = Date.now() + 60 * 24 * 60 * 60_000;

  return {
    walletExtension: {
      token: await new SignJWT({ credentialId, scope: "card:provisioning" })
        .setProtectedHeader({ alg: "HS256" })
        .setAudience("wallet-extension")
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime(Math.floor(expire / 1000))
        .sign(key),
      expire,
    },
  };
}

export function verifyToken(token: string) {
  return jwtVerify(token, key, { algorithms: ["HS256"], audience: "wallet-extension", issuer })
    .then(({ payload }) => parse(object({ credentialId: string(), scope: literal("card:provisioning") }), payload))
    .catch((error: unknown) => {
      captureException(error, { level: "warning" });
      return null;
    });
}
