import { deleteCookie, getSignedCookie } from "hono/cookie";

import { signIn } from "../utils/auth";

import type createBetterAuth from "../utils/auth";
import type { Context, Next } from "hono";
import type { BlankInput, Env, Input, MiddlewareHandler } from "hono/types";

export default function auth(betterAuth: ReturnType<typeof createBetterAuth>, legacySecret: string): Auth {
  const exchange = signIn(betterAuth);
  return async <E extends Env = Env, P extends string = string, I extends Input = BlankInput>(
    c: Context<E, P, AuthInput & I>,
    next: Next,
  ) => {
    const session = await betterAuth.api.getSession({ headers: c.req.raw.headers });
    let credentialId = session?.user.id;
    if (!credentialId) {
      const legacy = await getSignedCookie(c, legacySecret, "credential_id");
      if (!legacy) return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
      await exchange(c, legacy);
      deleteCookie(c, "credential_id", betterAuth.options.advanced.defaultCookieAttributes);
      credentialId = legacy;
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
