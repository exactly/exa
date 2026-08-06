import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import database from "../../database";
import org from "../../middleware/org";
import createAuth from "../../utils/auth";
import authSecret from "../../utils/authSecret";

const auth = createAuth(database, authSecret);

describe("organization middleware", () => {
  it("returns unauthorized when no session is present", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null);
    const app = new Hono().get("/", org(auth), (c) => c.text("ok"));
    const response = await app.request("/");
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized" });
  });

  it("passes through and exposes the session when authenticated", async () => {
    const fakeSession = { session: { id: "ses01", activeOrganizationId: "org01" }, user: { id: "user01" } };
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(fakeSession as never);
    const app = new Hono().get("/", org(auth), (c) => c.json(c.var.session));
    const response = await app.request("/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual(fakeSession);
  });
});
