import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import { Address, Base64URL } from "@exactly/common/validation";
import { captureException, setContext, setUser } from "@sentry/node";
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
  description,
  flatten,
  literal,
  metadata,
  number,
  object,
  optional,
  parse,
  picklist,
  pipe,
  record,
  string,
  title,
  unknown,
  type InferOutput,
} from "valibot";

import database, { credentials } from "../../database";
import androidOrigins from "../../utils/android/origins";
import appOrigin from "../../utils/appOrigin";
import authSecret from "../../utils/authSecret";
import redis from "../../utils/redis";

const Cookie = object({
  session_id: pipe(Base64URL, title("Session identifier"), description("HTTP-only cookie.")),
});

const AuthenticationOptions = pipe(
  object({
    challenge: pipe(Base64URL, title("Cryptographic challenge"), description("Random bytes to be signed.")),
    timeout: pipe(optional(number()), title("Time limit"), description("Maximum time to complete authentication.")),
    rpId: pipe(optional(string()), title("Service domain"), description("Domain being authenticated with.")),
    allowCredentials: pipe(
      optional(
        array(
          object({
            id: pipe(
              Base64URL,
              title("Credential identifier"),
              description("Unique identifier for the authenticator."),
            ),
            type: pipe(
              literal("public-key"),
              title("Credential type"),
              description("Always `public-key` for WebAuthn."),
            ),
            transports: pipe(
              optional(array(string())),
              title("Transport methods"),
              description("How the authenticator can be used."),
              metadata({ examples: ["usb", "nfc", "ble", "hybrid", "cable", "smart-card", "internal"] }),
            ),
          }),
        ),
      ),
      title("Valid authenticators"),
      description("List of authenticators that can be used for authentication."),
    ),
    userVerification: pipe(
      optional(picklist(["discouraged", "preferred", "required"])),
      title("User verification"),
      description("Whether user presence must be verified."),
    ),
    extensions: pipe(
      optional(record(string(), unknown())),
      title("Extensions"),
      description("Additional features to enable."),
    ),
  }),
  title("WebAuthn"),
);

const Authentication = pipe(
  object({
    expires: pipe(number(), title("Session expiry"), description("When the session will expire.")),
  }),
  title("Authentication response"),
);

export default new Hono()
  .get(
    "/",
    describeRoute({
      summary: "Get authentication options",
      description:
        "Initiates WebAuthn authentication by generating authentication options for a user. Sets a session HTTP-only cookie. This endpoint provides the necessary challenge, relying party info, and credential parameters required for client-side WebAuthn authentication.",
      responses: {
        200: {
          description: "WebAuthn authentication options",
          content: {
            "application/json": { schema: resolver(AuthenticationOptions, { errorMode: "ignore" }) },
          },
        },
      },
      tags: ["Credential"],
      validateResponse: true,
    }),
    vValidator(
      "query",
      object({
        credentialId: optional(
          pipe(Base64URL, title("Credential identifier"), description("Identifier of the authenticator to use.")),
        ),
      }),
      (validation, c) => {
        if (!validation.success) {
          captureException(new Error("bad credential"), {
            contexts: { validation: { ...validation, flatten: flatten(validation.issues) } },
          });
          return c.json("bad credential", 400);
        }
      },
    ),
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
          extensions: options.extensions as InferOutput<typeof AuthenticationOptions>["extensions"],
        } satisfies InferOutput<typeof AuthenticationOptions>,
        200,
      );
    },
  )
  .post(
    "/",
    describeRoute({
      summary: "Authenticate",
      description:
        "Authenticates a user using a WebAuthn credential. This endpoint verifies the authentication response from the client, updates the credential counter, and sets a signed cookie for the authenticated session.",
      responses: {
        200: {
          description: "Authentication response with session expiry",
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
      pipe(
        object({
          id: pipe(Base64URL, title("Credential identifier"), description("Unique identifier for the authenticator.")),
          rawId: pipe(Base64URL, title("Raw identifier"), description("Raw bytes of the credential identifier.")),
          response: object({
            clientDataJSON: pipe(Base64URL, title("Client data"), description("Authentication data from the client.")),
            authenticatorData: pipe(
              Base64URL,
              title("Authenticator data"),
              description("Data from the authenticator."),
            ),
            signature: pipe(Base64URL, title("Signature"), description("Cryptographic signature of the challenge.")),
            userHandle: optional(
              pipe(Base64URL, title("User handle"), description("Optional identifier for the user.")),
            ),
          }),
          clientExtensionResults: pipe(
            any(),
            title("Extension results"),
            description("Results of optional features enabled during authentication."),
          ),
          type: pipe(literal("public-key"), title("Credential type"), description("Always `public-key` for WebAuthn.")),
        }),
        title("WebAuthn"),
      ),
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
      setContext("auth", assertion);
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
