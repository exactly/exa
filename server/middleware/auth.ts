import { getSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { BlankInput, Env, Input } from "hono/types";

import betterAuth from "../utils/auth";
import authSecret from "../utils/authSecret";

export default function auth<E extends Env = Env, P extends string = string, I extends Input = BlankInput>() {
  return createMiddleware<E, P, I & { out: { cookie: { credentialId: string } } }>(async (c, next) => {
    const credentialId = await getSignedCookie(c, authSecret, "credential_id");
    if (!credentialId) {
      const session = await betterAuth.api.getSession({ headers: c.req.raw.headers });
      if (session) {
        await next();
        return;
      }
      return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
    }
    c.req.addValidatedData("cookie", { credentialId });
    await next();
  });
}
