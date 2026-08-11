import { captureException } from "@sentry/node";
import { jwtVerify, SignJWT } from "jose";
import { createSecretKey } from "node:crypto";
import { literal, object, parse, string } from "valibot";

const issuer = "exa-server";

export default function walletExtension(secret: string) {
  const key = createSecretKey(Buffer.from(secret, "utf8"));
  if ((key.symmetricKeySize ?? 0) < 32) throw new Error("wallet extension secret too short for HS256");
  return {
    create: (credentialId: string) => create(credentialId, key),
    verify: (token: string) => verify(token, key),
  };
}

async function create(credentialId: string, key: ReturnType<typeof createSecretKey>) {
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

async function verify(token: string, key: ReturnType<typeof createSecretKey>) {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], audience: "wallet-extension", issuer });
    return parse(object({ credentialId: string(), scope: literal("card:provisioning") }), payload);
  } catch (error) {
    captureException(error, { level: "warning" });
    return null;
  }
}
