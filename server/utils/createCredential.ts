import { captureException, setUser } from "@sentry/node";
import { setSignedCookie } from "hono/cookie";
import { parse } from "valibot";
import { hexToBytes, isAddress, zeroAddress } from "viem";
import { optimism } from "viem/chains";

import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import chain, { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import decodePublicKey from "./decodePublicKey";
import { credentials } from "../database/schema";

import type { IpAddress } from "./sardine";
import type createSardine from "./sardine";
import type createSegment from "./segment";
import type db from "../database";
import type createSubscribe from "../workers/subscribe/queue";
import type { WebAuthnCredential } from "@simplewebauthn/server";
import type { Context } from "hono";

export default function createCredential({
  authSecret,
  database,
  sardine,
  segment,
  subscribe,
}: {
  authSecret: string;
  database: typeof db;
  sardine: ReturnType<typeof createSardine>;
  segment: ReturnType<typeof createSegment>;
  subscribe: ReturnType<typeof createSubscribe>;
}) {
  return async function credential<C extends string>(
    c: Context,
    credentialId: C,
    options?: { factory?: Address; ip?: IpAddress; source?: string; webauthn?: WebAuthnCredential },
  ) {
    if (chain.id === optimism.id && isAddress(credentialId)) throw new Error("siwe registration disabled"); // TODO remove
    const factory = options?.factory ?? exaAccountFactoryAddress;
    const publicKey =
      options?.webauthn?.publicKey ?? (isAddress(credentialId) ? new Uint8Array(hexToBytes(credentialId)) : undefined);
    if (!publicKey) throw new Error("bad credential");
    const { x, y } = decodePublicKey(publicKey);
    const salt = parse(Address, zeroAddress);
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

    await Promise.all([
      setSignedCookie(c, "credential_id", credentialId, authSecret, {
        expires,
        httpOnly: true,
        ...(domain === "localhost"
          ? { sameSite: "lax", secure: false }
          : { domain, sameSite: "none", secure: true, partitioned: true }),
      }),
      sardine
        .customer({
          flow: { name: "signup", type: "signup" },
          customer: {
            id: credentialId,
            tags: [
              { name: "source", value: options?.source ?? "EXA", type: "string" },
              { name: "auth_method", value: isAddress(credentialId) ? "siwe" : "webauthn", type: "string" },
            ],
          },
          ...(options?.ip ? { device: { ip: options.ip } } : {}),
        })
        .catch((error: unknown) => captureException(error, { level: "error" })),
    ]);

    await subscribe.enqueue(account).catch(() => undefined);

    segment.identify({ userId: account });
    return { credentialId, factory: parse(Address, factory), x, y, salt, auth: expires.getTime() };
  };
}
