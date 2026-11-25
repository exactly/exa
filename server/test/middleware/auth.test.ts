import { Hono } from "hono";
import { serializeSigned } from "hono/utils/cookie";
import { describe, expect, it } from "vitest";

import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";

import createAuth from "../../middleware/auth";
import authSecret from "../../utils/authSecret";

const app = new Hono().get("/", createAuth(authSecret), (c) => c.json(c.req.valid("cookie")));

describe("auth middleware", () => {
  it("accepts unexpired cookie", async () => {
    const response = await request(`credential.${Date.now() + 60_000}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ credentialId: "credential" });
  });

  it("rejects expired cookie", async () => {
    const response = await request(`credential.${Date.now() - 1}`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("accepts expiry issued by a server with a skewed clock", async () => {
    const response = await request(`credential.${Date.now() + AUTH_EXPIRY + 5000}`);
    expect(response.status).toBe(200);
  });

  it("rejects expiry beyond session lifetime", async () => {
    const response = await request(`credential.${Date.now() + 2 * AUTH_EXPIRY}`);
    expect(response.status).toBe(401);
  });

  it("rejects unbounded expiry", async () => {
    const response = await request(`credential.${"9".repeat(400)}`);
    expect(response.status).toBe(401);
  });

  it("rejects cookie without expiry", async () => {
    const response = await request("credential");
    expect(response.status).toBe(401);
  });

  it("rejects cookie with tampered expiry", async () => {
    const expires = Date.now() + 60_000;
    const cookie = await serializeSigned("credential_id", `credential.${expires}`, authSecret);
    const tampered = cookie.replace(`.${expires}.`, `.${expires + 60_000}.`);
    expect(tampered).not.toBe(cookie);
    const response = await app.request("/", { headers: { cookie: tampered } });
    expect(response.status).toBe(401);
  });

  it("takes credential up to last separator", async () => {
    const response = await request(`a.1.${Date.now() + 60_000}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ credentialId: "a.1" });
  });

  it("rejects non-numeric expiry", async () => {
    const response = await request(`credential.${Date.now() + 60_000}ms`);
    expect(response.status).toBe(401);
  });

  it("rejects missing cookie", async () => {
    const response = await app.request("/");
    expect(response.status).toBe(401);
  });
});

async function request(value: string) {
  return app.request("/", { headers: { cookie: await serializeSigned("credential_id", value, authSecret) } });
}
