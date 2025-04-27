import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import chain, { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address, Base64URL } from "@exactly/common/validation";
import { vValidator } from "@hono/valibot-validator";
import { captureException, setUser } from "@sentry/node";
import {
  type AuthenticatorTransportFuture,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { cose, generateChallenge, isoBase64URL } from "@simplewebauthn/server/helpers";
import { Hono, type Env } from "hono";
import { setCookie, setSignedCookie } from "hono/cookie";
import { any, array, literal, nullish, object, parse, pipe, string, transform, type InferOutput } from "valibot";
import type { Hex } from "viem";
import { optimism } from "viem/chains";

import database, { credentials } from "../../database";
import { webhooksKey } from "../../utils/alchemy";
import androidOrigins from "../../utils/android/origins";
import appOrigin from "../../utils/appOrigin";
import authSecret from "../../utils/authSecret";
import decodePublicKey from "../../utils/decodePublicKey";
import deriveAddress from "../../utils/deriveAddress";
import redis from "../../utils/redis";
import { identify } from "../../utils/segment";

if (!process.env.ALCHEMY_ACTIVITY_ID) throw new Error("missing alchemy activity id");
const webhookId = process.env.ALCHEMY_ACTIVITY_ID;

const factory =
  { [optimism.id]: "0xcbeaAF42Cc39c17e84cBeFe85160995B515A9668" as const }[chain.id] ?? exaAccountFactoryAddress;

const Cookie = object({ session_id: Base64URL });

export default new Hono()
  .get("/", async (c) => {
    const timeout = 5 * 60_000;
    const userName = new Date().toISOString().slice(0, 16);
    const [options, sessionId] = await Promise.all([
      generateRegistrationOptions({
        rpID: domain,
        rpName: "exactly",
        userName,
        userDisplayName: userName,
        supportedAlgorithmIDs: [cose.COSEALG.ES256],
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
        // TODO excludeCredentials?
        timeout,
      }),
      generateChallenge().then(isoBase64URL.fromBuffer),
    ]);
    setCookie(c, "session_id", sessionId, { domain, expires: new Date(Date.now() + timeout), httpOnly: true });
    await redis.set(sessionId, options.challenge, "PX", timeout);
    return c.json({ ...options, extensions: options.extensions as Record<string, unknown> | undefined }, 200);
  })
  .post(
    "/",
    // http-only cookie
    vValidator<typeof Cookie, "cookie", Env, "/", undefined, InferOutput<typeof Cookie>>(
      "cookie",
      Cookie,
      ({ success }, c) => (success ? undefined : c.json("bad session", 400)),
    ),
    vValidator(
      "json",
      object({
        id: Base64URL,
        rawId: Base64URL,
        response: object({
          clientDataJSON: Base64URL,
          attestationObject: Base64URL,
          transports: pipe(
            nullish(array(string())),
            transform((value) => {
              if (!value) return;
              return value as AuthenticatorTransportFuture[];
            }),
          ),
        }),
        clientExtensionResults: any(),
        type: literal("public-key"),
      }),
      (validation, c) => {
        if (!validation.success) {
          captureException(new Error("bad registration"), { contexts: { validation } });
          return c.json("bad registration", 400);
        }
      },
    ),
    async (c) => {
      const { session_id: sessionId } = c.req.valid("cookie");
      const challenge = await redis.get(sessionId);
      if (!challenge) return c.json("no registration", 400);

      const attestation = c.req.valid("json");
      let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
      try {
        verification = await verifyRegistrationResponse({
          response: attestation,
          expectedRPID: domain,
          expectedOrigin: [appOrigin, ...androidOrigins],
          expectedChallenge: challenge,
          supportedAlgorithmIDs: [cose.COSEALG.ES256],
        });
      } catch (error) {
        captureException(error);
        return c.json(error instanceof Error ? error.message : String(error), 400);
      } finally {
        await redis.del(sessionId);
      }
      const { verified, registrationInfo } = verification;
      if (!verified || !registrationInfo) return c.json("bad registration", 400);

      const { credential, credentialDeviceType } = registrationInfo;
      if (credentialDeviceType !== "multiDevice") return c.json("backup eligibility required", 400); // TODO improve ux

      let x: Hex, y: Hex;
      try {
        ({ x, y } = decodePublicKey(credential.publicKey));
      } catch (error) {
        return c.json(error instanceof Error ? error.message : String(error), 400);
      }

      const expires = new Date(Date.now() + AUTH_EXPIRY);
      const account = deriveAddress(parse(Address, factory), { x, y });
      setUser({ id: account });
      await Promise.all([
        setSignedCookie(c, "credential_id", credential.id, authSecret, { domain, expires, httpOnly: true }),
        database.insert(credentials).values([
          {
            account,
            id: credential.id,
            publicKey: credential.publicKey,
            factory,
            transports: attestation.response.transports,
            counter: credential.counter,
          },
        ]),
        fetch("https://dashboard.alchemy.com/api/update-webhook-addresses", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "X-Alchemy-Token": webhooksKey },
          body: JSON.stringify({ webhook_id: webhookId, addresses_to_add: [account], addresses_to_remove: [] }),
        })
          .then(async (response) => {
            if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
          })
          .catch((error: unknown) => captureException(error)),
      ]);
      identify({ userId: account });

      return c.json({ credentialId: credential.id, factory, x, y, auth: expires.getTime() }, 200);
    },
  );
