import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { captureException, setUser } from "@sentry/core";
import type { WebAuthnCredential } from "@simplewebauthn/server";
import type { Context } from "hono";
import { setSignedCookie } from "hono/cookie";
import { parse } from "valibot";
import { hexToBytes, isAddress } from "viem";

import { headers as alchemyHeaders } from "./alchemy";
import authSecret from "./authSecret";
import decodePublicKey from "./decodePublicKey";
import { customer } from "./sardine";
import { identify } from "./segment";
import database from "../database";
import { credentials } from "../database/schema";
import { webhookId } from "../hooks/activity";

export default async function createCredential<C extends string>(
  c: Context,
  credentialId: C,
  webauthn?: WebAuthnCredential,
) {
  const publicKey =
    webauthn?.publicKey ?? (isAddress(credentialId) ? new Uint8Array(hexToBytes(credentialId)) : undefined);
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
      transports: webauthn?.transports,
      counter: webauthn?.counter,
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
    fetch("https://dashboard.alchemy.com/api/update-webhook-addresses", {
      method: "PATCH",
      headers: alchemyHeaders,
      body: JSON.stringify({ webhook_id: webhookId, addresses_to_add: [account], addresses_to_remove: [] }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
      })
      .catch((error: unknown) => captureException(error)),
    customer({ flow: { name: "signup", type: "signup" }, customer: { id: credentialId } }).catch((error: unknown) =>
      captureException(error, { level: "error" }),
    ),
  ]);
  identify({ userId: account });
  return { credentialId, factory: parse(Address, exaAccountFactoryAddress), x, y, auth: expires.getTime() };
}
