import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import { Address, Base64URL, Hex, Passkey } from "@exactly/common/validation";
import { captureException, setContext, setUser } from "@sentry/node";
import {
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { Hono, type Env } from "hono";
import { setCookie, setSignedCookie } from "hono/cookie";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import {
  any,
  array,
  description,
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
  union,
  unknown,
  variant,
  type InferOutput,
} from "valibot";
import { isAddress, verifyMessage } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";

import database, { credentials } from "../../database";
import androidOrigins from "../../utils/android/origins";
import appOrigin from "../../utils/appOrigin";
import authSecret from "../../utils/authSecret";
import createCredential from "../../utils/createCredential";
import decodePublicKey from "../../utils/decodePublicKey";
import redis from "../../utils/redis";
import validatorHook from "../../utils/validatorHook";

const Cookie = object({
  session_id: pipe(Base64URL, title("Session identifier"), description("HTTP-only cookie.")),
});

const AuthenticationOptions = variant("method", [
  pipe(
    object({
      method: pipe(literal("siwe"), title("Method"), description("Sign-in with Ethereum.")),
      address: pipe(Address, title("Address"), description("Address to sign in with.")),
      message: pipe(string(), title("Message"), description("Message to sign.")),
    }),
    title("Sign-in with Ethereum"),
  ),
  pipe(
    object({
      method: pipe(literal("webauthn"), title("Method"), description("WebAuthn.")),
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
  ),
]);

export const Authentication = object({
  ...Passkey.entries,
  auth: pipe(number(), title("Session expiry"), description("When the authenticated session will expire.")),
});

const LegacyAuthentication = object({
  ...Authentication.entries,
  expires: pipe(
    number(),
    title("Session expiry (legacy)"),
    description("This field is deprecated in favor of `auth` and will be removed in the next major version."),
  ),
});

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
          union([
            pipe(
              Address,
              title("Ethereum address"),
              description("Address to sign in with. Required for Sign-in with Ethereum."),
            ),
            pipe(
              Base64URL,
              title("Credential identifier"),
              description("Credential identifier to sign in with. Optional for WebAuthn."),
            ),
          ]),
        ),
      }),
      validatorHook({ code: "bad credential" }),
    ),
    async (c) => {
      const timeout = 5 * 60_000;
      const sessionId = generateSiweNonce();
      const issuedAt = new Date();
      const expires = new Date(issuedAt.getTime() + timeout);
      setCookie(c, "session_id", sessionId, { domain, expires, httpOnly: true });
      const { credentialId } = c.req.valid("query");
      if (credentialId && (isAddress as (address: string) => address is Address)(credentialId)) {
        const message = createSiweMessage({
          resources: ["https://exactly.github.io/exa"],
          statement: "Sign-in to the Exa App",
          expirationTime: expires,
          address: credentialId,
          chainId: chain.id,
          nonce: sessionId,
          uri: appOrigin,
          version: "1",
          issuedAt,
          domain,
          scheme,
        });
        await redis.set(sessionId, message, "PX", timeout);
        return c.json(
          { method: "siwe" as const, address: credentialId, message } satisfies InferOutput<
            typeof AuthenticationOptions
          >,
          200,
        );
      }
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
          content: { "application/json": { schema: resolver(LegacyAuthentication, { errorMode: "ignore" }) } },
        },
      },
      tags: ["Credential"],
      validateResponse: true,
    }),
    // http-only cookie
    vValidator<typeof Cookie, "cookie", Env, "/", undefined, InferOutput<typeof Cookie>>(
      "cookie",
      Cookie,
      validatorHook({ code: "bad session" }),
    ),
    vValidator(
      "json",
      variant("method", [
        pipe(
          object({
            method: pipe(literal("siwe"), title("Method"), description("Sign-in with Ethereum.")),
            id: pipe(Address, title("Address"), description("Address to sign in with.")),
            signature: pipe(Hex, title("Signature"), description("Signature of the cryptographic challenge message.")),
          }),
          title("Sign-in with Ethereum"),
        ),
        pipe(
          object({
            method: pipe(optional(literal("webauthn"), "webauthn"), title("Method"), description("WebAuthn.")),
            id: pipe(
              Base64URL,
              title("Credential identifier"),
              description("Unique identifier for the authenticator."),
            ),
            rawId: pipe(Base64URL, title("Raw identifier"), description("Raw bytes of the credential identifier.")),
            response: object({
              clientDataJSON: pipe(
                Base64URL,
                title("Client data"),
                description("Authentication data from the client."),
              ),
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
            type: pipe(
              literal("public-key"),
              title("Credential type"),
              description("Always `public-key` for WebAuthn."),
            ),
          }),
          title("WebAuthn"),
        ),
      ]),
      validatorHook({ code: "bad authentication" }),
    ),
    async (c) => {
      const assertion = c.req.valid("json");
      setContext("auth", assertion);
      const { session_id: sessionId } = c.req.valid("cookie");
      const [credential, challenge] = await Promise.all([
        database.query.credentials.findFirst({
          columns: { publicKey: true, account: true, factory: true, transports: true, counter: true },
          where: eq(credentials.id, assertion.id),
        }),
        redis.get(sessionId),
      ]);
      if (!challenge) return c.json({ code: "no authentication", legacy: "no authentication" }, 400);
      if (!credential) {
        if (assertion.method !== "siwe") return c.json({ code: "no credential", legacy: "no credential" }, 400);
        const message = parseSiweMessage(challenge);
        if (
          !validateSiweMessage({ message, address: assertion.id, nonce: sessionId, domain, scheme }) ||
          !(await verifyMessage({ message: challenge, address: assertion.id, signature: assertion.signature }))
        ) {
          return c.json({ code: "bad authentication", legacy: "bad authentication" }, 400);
        }
        const result = await createCredential(c, assertion.id);
        return c.json({ ...result, expires: result.auth } satisfies InferOutput<typeof LegacyAuthentication>, 200);
      }
      setUser({ id: parse(Address, credential.account) });

      let newCounter: number | undefined;
      try {
        switch (assertion.method) {
          case "siwe": {
            const message = parseSiweMessage(challenge);
            if (
              !validateSiweMessage({ message, address: assertion.id, nonce: sessionId, domain, scheme }) ||
              !(await verifyMessage({ message: challenge, address: assertion.id, signature: assertion.signature }))
            ) {
              return c.json({ code: "bad authentication", legacy: "bad authentication" }, 400);
            }
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
            if (!verified || authenticationInfo.credentialID !== assertion.id) {
              return c.json({ code: "bad authentication", legacy: "bad authentication" }, 400);
            }
            newCounter = authenticationInfo.newCounter;
          }
        }
      } catch (error) {
        captureException(error, { level: "error", tags: { unhandled: true } });
        return c.json({ code: "ouch", legacy: "ouch" }, 500);
      } finally {
        await redis.del(sessionId);
      }

      const expires = new Date(Date.now() + AUTH_EXPIRY);
      await Promise.all([
        setSignedCookie(c, "credential_id", assertion.id, authSecret, { domain, expires, httpOnly: true }),
        newCounter && database.update(credentials).set({ counter: newCounter }).where(eq(credentials.id, assertion.id)),
      ]);

      return c.json(
        {
          credentialId: assertion.id,
          factory: parse(Address, credential.factory),
          ...decodePublicKey(credential.publicKey),
          auth: expires.getTime(),
          expires: expires.getTime(),
        } satisfies InferOutput<typeof LegacyAuthentication>,
        200,
      );
    },
  );

const scheme = domain === "localhost" ? "http" : "https";
