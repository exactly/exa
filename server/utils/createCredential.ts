import { captureException, setUser } from "@sentry/node";
import { parse } from "valibot";
import { hexToBytes, isAddress, zeroAddress } from "viem";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import decodePublicKey from "./decodePublicKey";
import { credentials } from "../database/schema";

import type { IpAddress } from "./sardine";
import type createSardine from "./sardine";
import type createSegment from "./segment";
import type * as schema from "../database/schema";
import type createSubscribe from "../workers/subscribe/queue";
import type { WebAuthnCredential } from "@simplewebauthn/server";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Context } from "hono";

export default function createCredential({
  database,
  sardine,
  segment,
  signIn,
  subscribe,
}: {
  database: NodePgDatabase<typeof schema>;
  sardine: ReturnType<typeof createSardine>;
  segment: ReturnType<typeof createSegment>;
  signIn: (c: Context, credentialId: string) => Promise<Date>;
  subscribe: ReturnType<typeof createSubscribe>;
}) {
  return async function credential<C extends string>(
    c: Context,
    credentialId: C,
    options?: { factory?: Address; ip?: IpAddress; salt?: Address; source?: string; webauthn?: WebAuthnCredential },
  ) {
    const factory = options?.factory ?? exaAccountFactoryAddress;
    const publicKey =
      options?.webauthn?.publicKey ?? (isAddress(credentialId) ? new Uint8Array(hexToBytes(credentialId)) : undefined);
    if (!publicKey) throw new Error("bad credential");
    const { x, y } = decodePublicKey(publicKey);
    const salt = parse(Address, options?.salt ?? zeroAddress);
    const account = deriveAddress(factory, { x, y, salt });

    setUser({ id: account });
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

    const [expires] = await Promise.all([
      signIn(c, credentialId),
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
