import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import chain, { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address, Base64URL, Hex, Passkey } from "@exactly/common/validation";
import { captureException, setUser } from "@sentry/node";
import {
  type AuthenticatorTransportFuture,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { cose } from "@simplewebauthn/server/helpers";
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
  variant,
  type InferOutput,
} from "valibot";
import { padHex, zeroHash } from "viem";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";

import database, { credentials } from "../../database";
import { webhooksKey } from "../../utils/alchemy";
import androidOrigins from "../../utils/android/origins";
import appOrigin from "../../utils/appOrigin";
import authSecret from "../../utils/authSecret";
import decodePublicKey from "../../utils/decodePublicKey";
import deriveAddress from "../../utils/deriveAddress";
import publicClient from "../../utils/publicClient";
import redis from "../../utils/redis";
import { identify } from "../../utils/segment";

if (!process.env.ALCHEMY_ACTIVITY_ID) throw new Error("missing alchemy activity id");
const webhookId = process.env.ALCHEMY_ACTIVITY_ID;

const Cookie = object({ session_id: Base64URL });

const RegistrationOptions = variant("method", [
  object({
    method: literal("webauthn"),
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
  }),
  object({ method: literal("siwe"), address: Address, message: string() }),
]);

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
            "application/json": { schema: resolver(RegistrationOptions, { errorMode: "ignore" }) },
          },
        },
      },
      validateResponse: true,
    }),
    vValidator("query", object({ credentialId: optional(Address) }), ({ success }, c) => {
      if (!success) return c.json("bad credential", 400);
    }),
    async (c) => {
      const timeout = 5 * 60_000;
      const sessionId = generateSiweNonce();
      const { credentialId } = c.req.valid("query");
      const expires = new Date(Date.now() + timeout);
      setCookie(c, "session_id", sessionId, { domain, expires, httpOnly: true });
      if (credentialId) {
        const message = createSiweMessage({
          scheme: domain === "localhost" ? "http" : "https",
          nonce: generateSiweNonce(),
          expirationTime: expires,
          address: credentialId,
          chainId: chain.id,
          uri: appOrigin,
          version: "1",
          domain,
        });
        await redis.set(sessionId, message, "PX", timeout);
        return c.json({ method: "siwe" as const, address: credentialId, message }, 200);
      }
      const userName = new Date().toISOString().slice(0, 16);
      const options = await generateRegistrationOptions({
        rpID: domain,
        rpName: "exactly",
        userName,
        userDisplayName: userName,
        supportedAlgorithmIDs: [cose.COSEALG.ES256],
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
        // TODO excludeCredentials?
        timeout,
      });
      await redis.set(sessionId, options.challenge, "PX", timeout);
      return c.json(
        {
          method: "webauthn" as const,
          ...options,
          extensions: options.extensions as Extract<
            InferOutput<typeof RegistrationOptions>,
            { method: "webauthn" }
          >["extensions"],
        } satisfies InferOutput<typeof RegistrationOptions>,
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
      variant("method", [
        object({
          method: optional(literal("webauthn")),
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
        object({ method: literal("siwe"), id: Address, signature: Hex }),
      ]),
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
      const attestation = c.req.valid("json");
      const { session_id: sessionId } = c.req.valid("cookie");
      const challenge = await redis.get(sessionId);
      if (!challenge) return c.json("no registration", 400);

      let account: Address;
      let publicKey: Uint8Array;
      let transports: string[] | undefined;
      let x: Hex, y: Hex;
      let counter: number | undefined;
      try {
        switch (attestation.method) {
          case "siwe": {
            const valid = await publicClient.verifySiweMessage({
              message: challenge,
              signature: attestation.signature,
            });
            if (!valid) return c.json("bad authentication", 400);
            publicKey = new Uint8Array();
            x = padHex(attestation.id);
            y = zeroHash;
            account = deriveAddress(parse(Address, exaAccountFactoryAddress), { x, y });
            break;
          }
          default: {
            const { verified, registrationInfo } = await verifyRegistrationResponse({
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
            if (!verified || !registrationInfo) return c.json("bad registration", 400);
            const { credential, credentialDeviceType } = registrationInfo;
            if (credential.id !== attestation.id) return c.json("bad registration", 400);
            if (credentialDeviceType !== "multiDevice") return c.json("backup eligibility required", 400); // TODO improve ux
            try {
              publicKey = credential.publicKey;
              ({ x, y } = decodePublicKey(publicKey));
              account = deriveAddress(parse(Address, exaAccountFactoryAddress), { x, y });
              transports = credential.transports;
              counter = credential.counter;
            } catch (error) {
              return c.json(error instanceof Error ? error.message : String(error), 400);
            }
          }
        }
      } catch (error) {
        captureException(error);
        return c.json(error instanceof Error ? error.message : String(error), 400);
      } finally {
        await redis.del(sessionId);
      }

      setUser({ id: account });
      const expires = new Date(Date.now() + AUTH_EXPIRY);
      await Promise.all([
        setSignedCookie(c, "credential_id", attestation.id, authSecret, { domain, expires, httpOnly: true }),
        database
          .insert(credentials)
          .values([{ account, id: attestation.id, publicKey, factory: exaAccountFactoryAddress, transports, counter }]),
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
          credentialId: attestation.id,
          factory: parse(Address, exaAccountFactoryAddress),
          x,
          y,
          auth: expires.getTime(),
        } satisfies InferOutput<typeof AuthenticatedPasskey>,
        200,
      );
    },
  );
