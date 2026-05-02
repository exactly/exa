import { createMiddleware } from "hono/factory";

import auth from "../utils/auth";

import type { BlankInput, Env, Input } from "hono/types";

export default function org<E extends Env = Env, P extends string = string, I extends Input = BlankInput>() {
  return createMiddleware<
    E & { Variables: { session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>> } },
    P,
    I
  >(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ code: "unauthorized" }, 401);
    c.set("session", session);
    await next();
  });
}
