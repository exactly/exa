import { getSignedCookie } from "hono/cookie";

import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";

import type { Context, Next } from "hono";
import type { BlankInput, Env, Input, MiddlewareHandler } from "hono/types";

export const LEGACY_CUTOFF = Date.parse("2026-11-26T21:00:00Z");

export default function auth(secret: string): Auth {
  return async <E extends Env = Env, P extends string = string, I extends Input = BlankInput>(
    c: Context<E, P, AuthInput & I>,
    next: Next,
  ) => {
    const cookie = await getSignedCookie(c, secret, "credential_id");
    if (cookie && !cookie.includes(".") && Date.now() < LEGACY_CUTOFF) {
      c.req.addValidatedData("cookie", { credentialId: cookie });
      await next();
      return;
    }
    const [, credentialId, expires] = (cookie ? /^(.+)\.(\d+)$/.exec(cookie) : null) ?? [];
    const remaining = Number(expires) - Date.now();
    if (!credentialId || !(remaining > 0 && remaining <= AUTH_EXPIRY + 60_000)) {
      return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
    }
    c.req.addValidatedData("cookie", { credentialId });
    await next();
  };
}

export type Auth = (<E extends Env = Env, P extends string = string, I extends Input = BlankInput>(
  c: Context<E, P, AuthInput & I>,
  next: Next,
) => Promise<Response | undefined>) &
  MiddlewareHandler<Env, string, AuthInput>;

type AuthInput = { out: { cookie: { credentialId: string } } };
