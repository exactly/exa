import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address, Base64URL, Passkey } from "@exactly/common/validation";
import { captureException, setUser } from "@sentry/node";
import {
  type AuthenticatorTransportFuture,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { cose, generateChallenge, isoBase64URL } from "@simplewebauthn/server/helpers";
import { Hono, type Env } from "hono";
import { setCookie, setSignedCookie } from "hono/cookie";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import {
  any,
  array,
  boolean,
  flatten,
  literal,
  nullish,
  number,
  object,
  optional,
  parse,
  record,
  string,
  unknown,
  type InferOutput,
} from "valibot";
import type { Hex } from "viem";

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

const Cookie = object({ session_id: Base64URL });

const PublicKeyCredentialCreationOptionsJSON = object({
  rp: object({ name: string(), id: optional(string()) }),
  user: object({ id: string(), name: string(), displayName: string() }),
  challenge: string(),
  pubKeyCredParams: array(object({ type: literal("public-key"), alg: number() })),
  timeout: optional(number()),
  excludeCredentials: optional(
    array(object({ id: string(), type: literal("public-key"), transports: optional(array(string())) })),
  ),
  authenticatorSelection: optional(
    object({
      authenticatorAttachment: optional(string()),
      residentKey: optional(string()),
      userVerification: optional(string()),
      requireResidentKey: optional(boolean()),
    }),
  ),
  hints: optional(array(string())),
  attestation: optional(string()),
  attestationFormats: optional(array(string())),
  extensions: optional(record(string(), unknown())),
});

const AuthenticatedPasskey = object({ ...Passkey.entries, auth: number() });

export default new Hono()
  .get(
    "/",
    describeRoute({
      summary: "Get registration options",
      description: "Initiates WebAuthn registration by generating credential creation options for a new user.",
      responses: {
        200: {
          description:
            "WebAuthn registration options containing challenge, relying party info, and credential parameters for client-side credential creation.",
          content: {
            "application/json": { schema: resolver(PublicKeyCredentialCreationOptionsJSON, { errorMode: "ignore" }) },
          },
        },
      },
      tags: ["Credential"],
      validateResponse: true,
    }),
    async (c) => {
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
      return c.json(
        {
          ...options,
          extensions: options.extensions as InferOutput<typeof PublicKeyCredentialCreationOptionsJSON>["extensions"],
        } satisfies InferOutput<typeof PublicKeyCredentialCreationOptionsJSON>,
        200,
      );
    },
  )
  .post(
    "/",
    describeRoute({
      summary: "Register",
      description: "Registers a new WebAuthn credential for a user.",
      responses: {
        200: {
          description: "WebAuthn registration response containing credential ID and factory address.",
          content: { "application/json": { schema: resolver(AuthenticatedPasskey, { errorMode: "ignore" }) } },
        },
      },
      tags: ["Credential"],
      validateResponse: true,
    }),
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
          transports: nullish(array(string())),
        }),
        clientExtensionResults: any(),
        type: literal("public-key"),
      }),
      (validation, c) => {
        if (!validation.success) {
          captureException(new Error("bad registration"), {
            contexts: { validation: { ...validation, flatten: flatten(validation.issues) } },
          });
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
          response: {
            ...attestation,
            response: {
              ...attestation.response,
              transports: attestation.response.transports
                ? (attestation.response.transports as AuthenticatorTransportFuture[])
                : undefined,
            },
          },
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
      const account = deriveAddress(parse(Address, exaAccountFactoryAddress), { x, y });
      setUser({ id: account });
      await Promise.all([
        setSignedCookie(c, "credential_id", credential.id, authSecret, { domain, expires, httpOnly: true }),
        database.insert(credentials).values([
          {
            account,
            id: credential.id,
            publicKey: credential.publicKey,
            factory: exaAccountFactoryAddress,
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

      return c.json(
        {
          credentialId: credential.id,
          factory: parse(Address, exaAccountFactoryAddress),
          x,
          y,
          auth: expires.getTime(),
        } satisfies InferOutput<typeof AuthenticatedPasskey>,
        200,
      );
    },
  );
