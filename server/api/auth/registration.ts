import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import { Address, Base64URL, Hex, Passkey } from "@exactly/common/validation";
import { captureException, setContext } from "@sentry/node";
import {
  type AuthenticatorTransportFuture,
  generateRegistrationOptions,
  verifyRegistrationResponse,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { cose } from "@simplewebauthn/server/helpers";
import { Hono, type Env } from "hono";
import { setCookie } from "hono/cookie";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import {
  any,
  array,
  boolean,
  description,
  flatten,
  literal,
  nullish,
  number,
  object,
  optional,
  pipe,
  record,
  string,
  title,
  unknown,
  variant,
  type InferOutput,
} from "valibot";
import { verifyMessage } from "viem";
import { createSiweMessage, generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";

import androidOrigins from "../../utils/android/origins";
import appOrigin from "../../utils/appOrigin";
import createCredential from "../../utils/createCredential";
import redis from "../../utils/redis";

const Cookie = object({
  session_id: pipe(Base64URL, title("Session identifier"), description("HTTP-only cookie.")),
});

const RegistrationOptions = variant("method", [
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
      rp: pipe(
        object({
          name: pipe(string(), title("Service name"), description("Name of the service being registered with.")),
          id: pipe(
            optional(string()),
            title("Service domain"),
            description("Domain of the service being registered with."),
          ),
        }),
        title("Service"),
        description("Service the credential is being created for."),
      ),
      user: pipe(
        object({
          id: pipe(string(), title("User identifier"), description("Unique identifier in the service.")),
          name: pipe(string(), title("Username"), description("Username in the service.")),
          displayName: pipe(string(), title("Display name"), description("Name to be shown to the user.")),
        }),
        title("User"),
        description("Account information."),
      ),
      challenge: pipe(string(), title("Cryptographic challenge"), description("Random bytes to be signed.")),
      pubKeyCredParams: array(
        object({
          type: pipe(literal("public-key"), title("Credential type"), description("Always `public-key` for WebAuthn.")),
          alg: pipe(
            literal(cose.COSEALG.ES256),
            title("Cryptographic algorithm"),
            description("Should be `ES256` (-7) for Ethereum-compatible cryptography."),
          ),
        }),
      ),
      timeout: optional(pipe(number(), title("Time limit"), description("Maximum time to complete registration."))),
      excludeCredentials: optional(
        array(
          object({
            id: pipe(string(), title("Credential identifier"), description("Identifier of an existing credential.")),
            type: pipe(
              literal("public-key"),
              title("Credential type"),
              description("Always `public-key` for WebAuthn."),
            ),
            transports: optional(
              pipe(array(string()), title("Transport methods"), description("How the credential can be used.")),
            ),
          }),
        ),
      ),
      authenticatorSelection: optional(
        object({
          authenticatorAttachment: optional(
            pipe(string(), title("Authenticator type"), description("Type of authenticator to use.")),
          ),
          residentKey: optional(
            pipe(string(), title("Resident key"), description("Whether to create a discoverable credential.")),
          ),
          userVerification: optional(
            pipe(string(), title("User verification"), description("Whether user presence must be verified.")),
          ),
          requireResidentKey: optional(
            pipe(
              boolean(),
              title("Require resident key"),
              description("Whether a discoverable credential is required."),
            ),
          ),
        }),
      ),
      hints: optional(pipe(array(string()), title("UI hints"), description("Type of authentication UI to show."))),
      attestation: optional(
        pipe(string(), title("Attestation"), description("How to handle authenticator attestation.")),
      ),
      attestationFormats: optional(
        pipe(array(string()), title("Attestation formats"), description("What attestation formats to accept.")),
      ),
      extensions: optional(
        pipe(record(string(), unknown()), title("Extensions"), description("Additional features to enable.")),
      ),
    }),
    title("WebAuthn"),
  ),
]);

const AuthenticatedPasskey = object({ ...Passkey.entries, auth: number() });

export default new Hono()
  .get(
    "/",
    describeRoute({
      summary: "Get registration options",
      description:
        "Initiates WebAuthn registration by generating credential creation options for a new user. Sets a session HTTP-only cookie.",
      responses: {
        200: {
          description:
            "WebAuthn registration options containing challenge, relying party info, and credential parameters for client-side credential creation",
          content: {
            "application/json": { schema: resolver(RegistrationOptions, { errorMode: "ignore" }) },
          },
        },
      },
      tags: ["Credential"],
      validateResponse: true,
    }),
    vValidator(
      "query",
      optional(
        object({
          credentialId: optional(
            pipe(
              Address,
              title("Ethereum address"),
              description("Address to register with, if using Sign-in with Ethereum."),
            ),
          ),
        }),
      ),
      ({ success }, c) => {
        if (!success) return c.json("bad credential", 400);
      },
    ),
    async (c) => {
      const timeout = 5 * 60_000;
      const sessionId = generateSiweNonce();
      const issuedAt = new Date();
      const expires = new Date(issuedAt.getTime() + timeout);
      setCookie(c, "session_id", sessionId, { domain, expires, httpOnly: true });
      const query = c.req.valid("query");
      if (query?.credentialId) {
        const message = createSiweMessage({
          resources: ["https://exactly.github.io/exa"],
          statement: "Sign-in to the Exa App",
          expirationTime: expires,
          address: query.credentialId,
          chainId: chain.id,
          nonce: sessionId,
          uri: appOrigin,
          version: "1",
          issuedAt,
          domain,
          scheme,
        });
        await redis.set(sessionId, message, "PX", timeout);
        return c.json({ method: "siwe" as const, address: query.credentialId, message }, 200);
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
          description: "WebAuthn registration response containing credential identifier and factory address.",
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
            method: pipe(optional(literal("webauthn")), title("Method"), description("WebAuthn.")),
            id: pipe(
              Base64URL,
              title("Credential identifier"),
              description("Unique identifier for the authenticator."),
            ),
            rawId: pipe(Base64URL, title("Raw identifier"), description("Raw bytes of the credential identifier.")),
            response: object({
              clientDataJSON: pipe(Base64URL, title("Client data"), description("Registration data from the client.")),
              attestationObject: pipe(
                Base64URL,
                title("Attestation data"),
                description("Data from the authenticator."),
              ),
              transports: nullish(
                array(pipe(string(), title("Transport methods"), description("How the authenticator can be used."))),
              ),
            }),
            clientExtensionResults: pipe(
              any(),
              title("Extension results"),
              description("Results of optional features enabled during registration."),
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
      setContext("auth", attestation);
      const { session_id: sessionId } = c.req.valid("cookie");
      const challenge = await redis.get(sessionId);
      if (!challenge) return c.json("no registration", 400);

      let webauthn: WebAuthnCredential | undefined;
      try {
        switch (attestation.method) {
          case "siwe": {
            const message = parseSiweMessage(challenge);
            if (
              !validateSiweMessage({ message, address: attestation.id, nonce: sessionId, domain, scheme }) ||
              !(await verifyMessage({ message: challenge, address: attestation.id, signature: attestation.signature }))
            ) {
              return c.json("bad authentication", 400);
            }
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
            webauthn = credential;
          }
        }
      } catch (error) {
        captureException(error);
        return c.json(error instanceof Error ? error.message : String(error), 400);
      } finally {
        await redis.del(sessionId);
      }

      return c.json(
        (await createCredential(c, attestation.id, webauthn)) satisfies InferOutput<typeof AuthenticatedPasskey>,
        200,
      );
    },
  );

const scheme = domain === "localhost" ? "http" : "https";
