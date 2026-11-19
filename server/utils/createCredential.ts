import { captureException, setUser } from "@sentry/node";
import { setSignedCookie } from "hono/cookie";
import crypto from "node:crypto";
import { parse } from "valibot";
import { hexToBytes, isAddress, zeroAddress } from "viem";

import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import decodePublicKey from "./decodePublicKey";
import { session, SESSION_TTL, signals } from "./sardine";
import { credentials } from "../database/schema";

import type { IpAddress, passkey } from "./sardine";
import type createSardine from "./sardine";
import type createSegment from "./segment";
import type * as schema from "../database/schema";
import type createSubscribe from "../workers/subscribe/queue";
import type { WebAuthnCredential } from "@simplewebauthn/server";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Context } from "hono";
import type { Redis } from "ioredis";

export default function createCredential({
  authSecret,
  database,
  redis,
  sardine,
  segment,
  subscribe,
}: {
  authSecret: string;
  database: NodePgDatabase<typeof schema>;
  redis: Redis;
  sardine: ReturnType<typeof createSardine>;
  segment: ReturnType<typeof createSegment>;
  subscribe: ReturnType<typeof createSubscribe>;
}) {
  return async function credential<C extends string>(
    c: Context,
    credentialId: C,
    options?: {
      factory?: Address;
      ip?: IpAddress;
      salt?: Address;
      source?: string;
      tags?: ReturnType<typeof passkey>;
      webauthn?: WebAuthnCredential;
    },
  ) {
    const factory = options?.factory ?? exaAccountFactoryAddress;
    const publicKey =
      options?.webauthn?.publicKey ?? (isAddress(credentialId) ? new Uint8Array(hexToBytes(credentialId)) : undefined);
    if (!publicKey) throw new Error("bad credential");
    const { x, y } = decodePublicKey(publicKey);
    const salt = parse(Address, options?.salt ?? zeroAddress);
    const account = deriveAddress(factory, { x, y, salt });

    setUser({ id: account });
    const expires = new Date(Date.now() + AUTH_EXPIRY);
    await database.insert(credentials).values([
      {
        account,
        id: credentialId,
        publicKey,
        factory,
        salt,
        transports: options?.webauthn?.transports,
        source: options?.source,
      },
    ]);

    const device = signals(c, options?.ip);
    const sessionKey = crypto.randomUUID();
    await Promise.all([
      setSignedCookie(c, "credential_id", credentialId, authSecret, {
        expires,
        httpOnly: true,
        ...(domain === "localhost"
          ? { sameSite: "lax", secure: false }
          : { sameSite: "none", secure: true, partitioned: true }),
      }),
      sardine
        .customer({
          flow: { name: "signup", type: "signup" },
          sessionKey,
          checkpoints: ["customer"],
          customer: {
            id: credentialId,
            tags: [
              { name: "source", value: options?.source ?? "EXA", type: "string" },
              { name: "auth_method", value: isAddress(credentialId) ? "siwe" : "webauthn", type: "string" },
              ...(options?.tags ?? []),
            ],
          },
          ...(device && { device }),
        })
        .catch((error: unknown) => captureException(error, { level: "error" })),
      redis
        .set(session(credentialId), sessionKey, "EX", SESSION_TTL)
        .catch((error: unknown) => captureException(error, { level: "error" })),
    ]);

    await subscribe.enqueue(account).catch(() => undefined);

    segment.identify({ userId: account });
    return { credentialId, factory: parse(Address, factory), x, y, salt, auth: expires.getTime() };
  };
}
