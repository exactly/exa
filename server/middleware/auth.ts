import { getSignedCookie } from "hono/cookie";

import type { Context, Next } from "hono";
import type { BlankInput, Env, Input, MiddlewareHandler } from "hono/types";

export default function auth(secret: string): Auth {
  return async <E extends Env = Env, P extends string = string, I extends Input = BlankInput>(
    c: Context<E, P, AuthInput & I>,
    next: Next,
  ) => {
    const credentialId = await getSignedCookie(c, secret, "credential_id");
    if (!credentialId) return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
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
