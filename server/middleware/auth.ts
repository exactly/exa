import type createBetterAuth from "../utils/auth";
import type { Context, Next } from "hono";
import type { BlankInput, Env, Input, MiddlewareHandler } from "hono/types";

export default function auth(betterAuth: ReturnType<typeof createBetterAuth>): Auth {
  return async <E extends Env = Env, P extends string = string, I extends Input = BlankInput>(
    c: Context<E, P, AuthInput & I>,
    next: Next,
  ) => {
    const session = await betterAuth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
    c.req.addValidatedData("cookie", { credentialId: session.user.id });
    await next();
  };
}

export type Auth = (<E extends Env = Env, P extends string = string, I extends Input = BlankInput>(
  c: Context<E, P, AuthInput & I>,
  next: Next,
) => Promise<Response | undefined>) &
  MiddlewareHandler<Env, string, AuthInput>;

type AuthInput = { out: { cookie: { credentialId: string } } };
