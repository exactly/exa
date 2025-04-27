import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import { Address, Base64URL } from "@exactly/common/validation";
import { vValidator } from "@hono/valibot-validator";
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
import { any, literal, object, optional, parse, type InferOutput } from "valibot";

import database, { credentials } from "../../database";
import androidOrigins from "../../utils/android/origins";
import appOrigin from "../../utils/appOrigin";
import authSecret from "../../utils/authSecret";
import redis from "../../utils/redis";

const Cookie = object({ session_id: Base64URL });

export default new Hono()
  .get(
    "/",
    vValidator("query", object({ credentialId: optional(Base64URL) }), ({ success }, c) => {
      if (!success) return c.json("bad credential", 400);
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
      return c.json({ ...options, extensions: options.extensions as Record<string, unknown> | undefined }, 200);
    },
  )
  .post(
    "/",
    vValidator("query", object({ credentialId: Base64URL }), ({ success }, c) => {
      if (!success) return c.json("bad credential", 400);
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
        response: object({ clientDataJSON: Base64URL, authenticatorData: Base64URL, signature: Base64URL }),
        clientExtensionResults: any(),
        type: literal("public-key"),
      }),
      (validation, c) => {
        if (!validation.success) {
          captureException(new Error("bad authentication"), { contexts: { validation } });
          return c.json("bad authentication", 400);
        }
      },
    ),
    async (c) => {
      const { credentialId } = c.req.valid("query");
      const { session_id: sessionId } = c.req.valid("cookie");
      const [credential, challenge] = await Promise.all([
        database.query.credentials.findFirst({
          columns: { publicKey: true, account: true, transports: true, counter: true },
          where: eq(credentials.id, credentialId),
        }),
        redis.get(sessionId),
      ]);
      if (!credential) return c.json("unknown credential", 400);
      setUser({ id: parse(Address, credential.account) });
      if (!challenge) return c.json("no authentication", 400);

      let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
      try {
        verification = await verifyAuthenticationResponse({
          response: c.req.valid("json"),
          expectedRPID: domain,
          expectedOrigin: [appOrigin, ...androidOrigins],
          expectedChallenge: challenge,
          credential: {
            id: credentialId,
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
      if (!verified) return c.json("bad authentication", 400);

      const expires = new Date(Date.now() + AUTH_EXPIRY);
      await Promise.all([
        setSignedCookie(c, "credential_id", credentialId, authSecret, { domain, expires, httpOnly: true }),
        database.update(credentials).set({ counter: newCounter }).where(eq(credentials.id, credentialID)),
      ]);

      return c.json({ expires: expires.getTime() }, 200);
    },
  );
