import { captureException, setUser } from "@sentry/core";
import { setSignedCookie } from "hono/cookie";
import { parse } from "valibot";
import { hexToBytes, isAddress } from "viem";

import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { updateWebhookAddresses } from "./alchemy";
import authSecret from "./authSecret";
import decodePublicKey from "./decodePublicKey";
import { customer } from "./sardine";
import { identify } from "./segment";
import database from "../database";
import { credentials } from "../database/schema";
import { webhookId } from "../hooks/activity";

import type { WebAuthnCredential } from "@simplewebauthn/server";
import type { Context } from "hono";

export default async function createCredential<C extends string>(
  c: Context,
  credentialId: C,
  options?: { source?: string; webauthn?: WebAuthnCredential },
) {
  const publicKey =
    options?.webauthn?.publicKey ?? (isAddress(credentialId) ? new Uint8Array(hexToBytes(credentialId)) : undefined);
  if (!publicKey) throw new Error("bad credential");
  const { x, y } = decodePublicKey(publicKey);
  const account = deriveAddress(exaAccountFactoryAddress, { x, y });

  setUser({ id: account });
  const expires = new Date(Date.now() + AUTH_EXPIRY);
  await database.insert(credentials).values([
    {
      account,
      id: credentialId,
      publicKey,
      factory: exaAccountFactoryAddress,
      transports: options?.webauthn?.transports,
      counter: options?.webauthn?.counter,
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
    updateWebhookAddresses(webhookId, [account]).catch((error: unknown) => captureException(error)),
    customer({
      flow: { name: "signup", type: "signup" },
      customer: {
        id: credentialId,
        tags: [{ name: "source", value: options?.source ?? "EXA", type: "string" }],
      },
    }).catch((error: unknown) => captureException(error, { level: "error" })),
  ]);
  identify({ userId: account });
  return { credentialId, factory: parse(Address, exaAccountFactoryAddress), x, y, auth: expires.getTime() };
}
