import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address, Base64URL, Passkey } from "@exactly/common/validation";
import { captureException, setContext, setUser } from "@sentry/node";
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
  description,
  flatten,
  literal,
  nullish,
  number,
  object,
  optional,
  parse,
  pipe,
  record,
  string,
  title,
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
import redis from "../../utils/redis";
import { identify } from "../../utils/segment";

if (!process.env.ALCHEMY_ACTIVITY_ID) throw new Error("missing alchemy activity id");
const webhookId = process.env.ALCHEMY_ACTIVITY_ID;

const Cookie = object({
  session_id: pipe(Base64URL, title("Session identifier"), description("HTTP-only cookie.")),
});

const RegistrationOptions = pipe(
  object({
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
          type: pipe(literal("public-key"), title("Credential type"), description("Always `public-key` for WebAuthn.")),
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
          pipe(boolean(), title("Require resident key"), description("Whether a discoverable credential is required.")),
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
);

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
          extensions: options.extensions as InferOutput<typeof RegistrationOptions>["extensions"],
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
      pipe(
        object({
          id: pipe(Base64URL, title("Credential identifier"), description("Unique identifier for the authenticator.")),
          rawId: pipe(Base64URL, title("Raw identifier"), description("Raw bytes of the credential identifier.")),
          response: object({
            clientDataJSON: pipe(Base64URL, title("Client data"), description("Registration data from the client.")),
            attestationObject: pipe(Base64URL, title("Attestation data"), description("Data from the authenticator.")),
            transports: nullish(
              array(pipe(string(), title("Transport methods"), description("How the authenticator can be used."))),
            ),
          }),
          clientExtensionResults: pipe(
            any(),
            title("Extension results"),
            description("Results of optional features enabled during registration."),
          ),
          type: pipe(literal("public-key"), title("Credential type"), description("Always `public-key` for WebAuthn.")),
        }),
        title("WebAuthn"),
      ),
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
      setContext("auth", attestation);
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
