import { createMiddleware } from "hono/factory";
import { vi } from "vitest";

vi.mock("../../middleware/auth", () => ({
  default: () =>
    createMiddleware(async (c, next) => {
      const credentialId = c.req.header("test-credential-id");
      if (!credentialId) return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
      c.req.addValidatedData("cookie", { credentialId });
      await next();
    }),
}));
