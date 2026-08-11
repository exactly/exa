import type createBetterAuth from "../utils/auth";
import type { Context, Next } from "hono";
import type { BlankInput, Env, Input, MiddlewareHandler } from "hono/types";

export default function org(betterAuth: ReturnType<typeof createBetterAuth>): Org {
  return async <E extends Env = Env, P extends string = string, I extends Input = BlankInput>(
    c: Context<E & OrganizationVariables, P, I>,
    next: Next,
  ) => {
    const session = await betterAuth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ code: "unauthorized" }, 401);
    c.set("session", session);
    await next();
  };
}

export type Org = (<E extends Env = Env, P extends string = string, I extends Input = BlankInput>(
  c: Context<E & OrganizationVariables, P, I>,
  next: Next,
) => Promise<Response | undefined>) &
  MiddlewareHandler<Env & OrganizationVariables, string, BlankInput>;

type OrganizationVariables = { Variables: { session: Session } };
type Session = NonNullable<Awaited<ReturnType<ReturnType<typeof createBetterAuth>["api"]["getSession"]>>>;
