import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import { Address, Base64URL, Hex } from "@exactly/common/validation";
import { vValidator } from "@hono/valibot-validator";
import { captureException, setUser } from "@sentry/node";
import {
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { Hono, type Env } from "hono";
import { setCookie, setSignedCookie } from "hono/cookie";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/valibot";
import {
  any,
  array,
  flatten,
  literal,
  number,
  object,
  optional,
  parse,
  picklist,
  record,
  string,
  unknown,
  variant,
  type InferOutput,
} from "valibot";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";

import database, { credentials } from "../../database";
import androidOrigins from "../../utils/android/origins";
import appOrigin from "../../utils/appOrigin";
import authSecret from "../../utils/authSecret";
import publicClient from "../../utils/publicClient";
import redis from "../../utils/redis";

const Cookie = object({ session_id: Base64URL });

const AuthenticationOptions = variant("method", [
  object({
    method: literal("webauthn"),
    challenge: Base64URL,
    timeout: optional(number()),
    rpId: optional(string()),
    allowCredentials: optional(
      array(object({ id: Base64URL, type: literal("public-key"), transports: optional(array(string())) })),
    ),
    userVerification: optional(picklist(["discouraged", "preferred", "required"])),
    extensions: optional(record(string(), unknown())),
  }),
  object({ method: literal("siwe"), address: Address, message: string() }),
]);

const Authentication = object({ expires: number() });

export default new Hono()
  .get(
    "/",
    describeRoute({
      summary: "Get authentication options",
      description: "Initiates WebAuthn authentication by generating authentication options for a user.",
      responses: {
        200: {
          description:
            "WebAuthn authentication options containing challenge, relying party info, and credential parameters for client-side authentication.",
          content: {
            "application/json": { schema: resolver(AuthenticationOptions, { errorMode: "ignore" }) },
          },
        },
      },
      validateResponse: true,
    }),
    vValidator(
      "query",
      variant("method", [
        object({ method: literal("siwe"), credentialId: Address }),
        object({ method: optional(literal("webauthn"), "webauthn"), credentialId: optional(Base64URL) }),
      ]),
      ({ success }, c) => (success ? undefined : c.json("bad credential", 400)),
    ),
    async (c) => {
      const timeout = 5 * 60_000;
      const sessionId = generateSiweNonce();
      const { method, credentialId } = c.req.valid("query");
      const issuedAt = new Date();
      const expires = new Date(issuedAt.getTime() + timeout);
      setCookie(c, "session_id", sessionId, { domain, expires, httpOnly: true });
      switch (method) {
        case "siwe": {
          const message = createSiweMessage({
            statement: "Sign-in to the Exa App",
            resources: ["https://exactly.github.io/exa/"],
            scheme: domain === "localhost" ? "http" : "https",
            nonce: generateSiweNonce(),
            expirationTime: expires,
            address: credentialId,
            chainId: chain.id,
            uri: appOrigin,
            version: "1",
            issuedAt,
            domain,
          });
          await redis.set(sessionId, message, "PX", timeout);
          return c.json({ method: "siwe" as const, address: credentialId, message }, 200);
        }
        default: {
          const options = await generateAuthenticationOptions({
            rpID: domain,
            allowCredentials: credentialId ? [{ id: credentialId }] : undefined,
            timeout,
          });
          await redis.set(sessionId, options.challenge, "PX", timeout);
          return c.json(
            {
              method: "webauthn" as const,
              ...options,
              extensions: options.extensions as Extract<
                InferOutput<typeof AuthenticationOptions>,
                { method: "webauthn" }
              >["extensions"],
            } satisfies InferOutput<typeof AuthenticationOptions>,
            200,
          );
        }
      }
    },
  )
  .post(
    "/",
    describeRoute({
      summary: "Authenticate",
      description: "Authenticates a user using a WebAuthn credential.",
      responses: {
        200: {
          description: "Authentication response containing credential ID and factory address.",
          content: { "application/json": { schema: resolver(Authentication, { errorMode: "ignore" }) } },
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
            authenticatorData: Base64URL,
            signature: Base64URL,
            userHandle: optional(Base64URL),
          }),
          clientExtensionResults: any(),
          type: literal("public-key"),
        }),
        object({ method: literal("siwe"), id: Address, signature: Hex }),
      ]),
      (validation, c) => {
        if (!validation.success) {
          captureException(new Error("bad authentication"), {
            contexts: { validation: { ...validation, flatten: flatten(validation.issues) } },
          });
          return c.json("bad authentication", 400);
        }
      },
    ),
    async (c) => {
      const assertion = c.req.valid("json");
      const { session_id: sessionId } = c.req.valid("cookie");
      const [credential, challenge] = await Promise.all([
        database.query.credentials.findFirst({
          columns: { publicKey: true, account: true, transports: true, counter: true },
          where: eq(credentials.id, assertion.id),
        }),
        redis.get(sessionId),
      ]);
      if (!credential) return c.json("unknown credential", 400);
      setUser({ id: parse(Address, credential.account) });
      if (!challenge) return c.json("no authentication", 400);

      let newCounter: number | undefined;
      try {
        switch (assertion.method) {
          case "siwe": {
            const valid = await publicClient.verifySiweMessage({ message: challenge, signature: assertion.signature });
            if (!valid) return c.json("bad authentication", 400);
            break;
          }
          default: {
            const { verified, authenticationInfo } = await verifyAuthenticationResponse({
              response: assertion,
              expectedRPID: domain,
              expectedOrigin: [appOrigin, ...androidOrigins],
              expectedChallenge: challenge,
              credential: {
                id: assertion.id,
                publicKey: credential.publicKey,
                transports: credential.transports
                  ? (credential.transports as AuthenticatorTransportFuture[])
                  : undefined,
                counter: credential.counter,
              },
            });
            if (!verified || authenticationInfo.credentialID !== assertion.id) return c.json("bad authentication", 400);
            newCounter = authenticationInfo.newCounter;
          }
        }
      } catch (error) {
        captureException(error);
        return c.json(error instanceof Error ? error.message : String(error), 400);
      } finally {
        await redis.del(sessionId);
      }

      const expires = new Date(Date.now() + AUTH_EXPIRY);
      await Promise.all([
        setSignedCookie(c, "credential_id", assertion.id, authSecret, { domain, expires, httpOnly: true }),
        newCounter && database.update(credentials).set({ counter: newCounter }).where(eq(credentials.id, assertion.id)),
      ]);

      return c.json({ expires: expires.getTime() } satisfies InferOutput<typeof Authentication>, 200);
    },
  );
