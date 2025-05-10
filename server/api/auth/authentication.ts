import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import { Address, Base64URL } from "@exactly/common/validation";
import { captureException, setUser } from "@sentry/node";
import {
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { generateChallenge, isoBase64URL } from "@simplewebauthn/server/helpers";
import { eq } from "drizzle-orm";
import { Hono, type Env } from "hono";
import { setCookie, setSignedCookie } from "hono/cookie";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
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
  type InferOutput,
} from "valibot";

import database, { credentials } from "../../database";
import androidOrigins from "../../utils/android/origins";
import appOrigin from "../../utils/appOrigin";
import authSecret from "../../utils/authSecret";
import redis from "../../utils/redis";

const Cookie = object({ session_id: Base64URL });

const PublicKeyCredentialRequestOptionsJSON = object({
  challenge: Base64URL,
  timeout: optional(number()),
  rpId: optional(string()),
  allowCredentials: optional(
    array(object({ id: Base64URL, type: literal("public-key"), transports: optional(array(string())) })),
  ),
  userVerification: optional(picklist(["discouraged", "preferred", "required"])),
  extensions: optional(record(string(), unknown())),
});

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
            "application/json": { schema: resolver(PublicKeyCredentialRequestOptionsJSON, { errorMode: "ignore" }) },
          },
        },
      },
      tags: ["Credential"],
      validateResponse: true,
    }),
    vValidator("query", object({ credentialId: optional(Base64URL) }), (validation, c) => {
      if (!validation.success) {
        captureException(new Error("bad credential"), {
          contexts: { validation: { ...validation, flatten: flatten(validation.issues) } },
        });
        return c.json("bad credential", 400);
      }
    }),
    async (c) => {
      const timeout = 5 * 60_000;
      const { credentialId } = c.req.valid("query");
      const [options, sessionId] = await Promise.all([
        generateAuthenticationOptions({
          rpID: domain,
          allowCredentials: credentialId ? [{ id: credentialId }] : undefined,
          timeout,
        }),
        generateChallenge().then(isoBase64URL.fromBuffer),
      ]);
      setCookie(c, "session_id", sessionId, { domain, expires: new Date(Date.now() + timeout), httpOnly: true });
      await redis.set(sessionId, options.challenge, "PX", timeout);
      return c.json(
        {
          ...options,
          extensions: options.extensions as InferOutput<typeof PublicKeyCredentialRequestOptionsJSON>["extensions"],
        } satisfies InferOutput<typeof PublicKeyCredentialRequestOptionsJSON>,
        200,
      );
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
          authenticatorData: Base64URL,
          signature: Base64URL,
          userHandle: optional(Base64URL),
        }),
        clientExtensionResults: any(),
        type: literal("public-key"),
      }),
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

      let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
      try {
        verification = await verifyAuthenticationResponse({
          response: assertion,
          expectedRPID: domain,
          expectedOrigin: [appOrigin, ...androidOrigins],
          expectedChallenge: challenge,
          credential: {
            id: assertion.id,
            publicKey: credential.publicKey,
            transports: credential.transports ? (credential.transports as AuthenticatorTransportFuture[]) : undefined,
            counter: credential.counter,
          },
        });
      } catch (error) {
        captureException(error);
        return c.json(error instanceof Error ? error.message : String(error), 400);
      } finally {
        await redis.del(sessionId);
      }
      const {
        verified,
        authenticationInfo: { credentialID, newCounter },
      } = verification;
      if (!verified || credentialID !== assertion.id) return c.json("bad authentication", 400);

      const expires = new Date(Date.now() + AUTH_EXPIRY);
      await Promise.all([
        setSignedCookie(c, "credential_id", assertion.id, authSecret, { domain, expires, httpOnly: true }),
        database.update(credentials).set({ counter: newCounter }).where(eq(credentials.id, credentialID)),
      ]);

      return c.json({ expires: expires.getTime() } satisfies InferOutput<typeof Authentication>, 200);
    },
  );
