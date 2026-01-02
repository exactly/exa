import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { setUser } from "@sentry/core";
import { captureException } from "@sentry/node";
import type { WebAuthnCredential } from "@simplewebauthn/server";
import type { Context } from "hono";
import { setSignedCookie } from "hono/cookie";
import { parse } from "valibot";
import { hexToBytes, isAddress } from "viem";

import database from "../database";
import authSecret from "./authSecret";
import decodePublicKey from "./decodePublicKey";
import { customer } from "./sardine";
import { identify } from "./segment";
import { credentials } from "../database/schema";
import { webhookId } from "../hooks/activity";
import { alchemyQueue } from "../queues/alchemyQueue";
import { AlchemyJob } from "../queues/constants";

export default async function createCredential<C extends string>(
  c: Context,
  credentialId: C,
  webauthn?: WebAuthnCredential,
) {
  const publicKey = webauthn?.publicKey ?? (isAddress(credentialId) ? hexToBytes(credentialId) : undefined);
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
    alchemyQueue.add(AlchemyJob.ADD_SUBSCRIBER, { account, webhookId }).catch((error: unknown) => {
      captureException(error);
    }),
    customer({ flow: { name: "signup", type: "signup" }, customer: { id: credentialId } }).catch((error: unknown) =>
      captureException(error, { level: "error" }),
    ),
  ]);
  identify({ userId: account });
  return { credentialId, factory: parse(Address, exaAccountFactoryAddress), x, y, auth: expires.getTime() };
}
