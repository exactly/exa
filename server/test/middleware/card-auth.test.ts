import { Hono } from "hono";
import { serializeSigned } from "hono/utils/cookie";
import { validator as vValidator } from "hono-openapi/valibot";
import { array, object, optional, parse, picklist, union } from "valibot";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { credentials, users, walletAddresses } from "../../database";
import cardAuth from "../../middleware/card-auth";
import auth from "../../utils/auth";
import authSecret from "../../utils/authSecret";
import { createToken } from "../../utils/walletExtension";

const primary = parse(Address, "0x0000000000000000000000000000000000000ca1");
const single = parse(Address, "0x0000000000000000000000000000000000000ca3");

const app = new Hono().get(
  "/",
  vValidator(
    "query",
    object({
      scope: optional(
        union([picklist(["provisioning", "siwe", "webauthn"]), array(picklist(["provisioning", "siwe", "webauthn"]))]),
      ),
    }),
  ),
  cardAuth(),
  (c) => c.json({ credentialId: c.req.valid("cookie").credentialId }),
);

describe("card auth middleware", () => {
  beforeAll(async () => {
    await database.insert(users).values([
      { id: "card-auth-primary-user", name: "primary", email: "card-auth-primary@example.com" },
      { id: "card-auth-single-user", name: "single", email: "card-auth-single@example.com" },
      { id: "card-auth-empty-user", name: "empty", email: "card-auth-empty@example.com" },
      { id: "card-auth-ambiguous-user", name: "ambiguous", email: "card-auth-ambiguous@example.com" },
      { id: "card-auth-missing-user", name: "missing", email: "card-auth-missing@example.com" },
    ]);
    await database.insert(walletAddresses).values([
      {
        id: "card-auth-fallback-wallet",
        userId: "card-auth-primary-user",
        address: parse(Address, "0x0000000000000000000000000000000000000ca2"),
        chainId: chain.id,
        isPrimary: false,
        createdAt: new Date(),
      },
      {
        id: "card-auth-primary-wallet",
        userId: "card-auth-primary-user",
        address: primary,
        chainId: chain.id,
        isPrimary: true,
        createdAt: new Date(),
      },
      {
        id: "card-auth-single-wallet",
        userId: "card-auth-single-user",
        address: single,
        chainId: chain.id,
        isPrimary: false,
        createdAt: new Date(),
      },
      {
        id: "card-auth-ambiguous-wallet-one",
        userId: "card-auth-ambiguous-user",
        address: parse(Address, "0x0000000000000000000000000000000000000ca4"),
        chainId: chain.id,
        isPrimary: false,
        createdAt: new Date(),
      },
      {
        id: "card-auth-ambiguous-wallet-two",
        userId: "card-auth-ambiguous-user",
        address: parse(Address, "0x0000000000000000000000000000000000000ca5"),
        chainId: chain.id,
        isPrimary: false,
        createdAt: new Date(),
      },
      {
        id: "card-auth-missing-wallet",
        userId: "card-auth-missing-user",
        address: parse(Address, "0x0000000000000000000000000000000000000ca6"),
        chainId: chain.id,
        isPrimary: false,
        createdAt: new Date(),
      },
    ]);
    await database.insert(credentials).values([
      {
        id: primary,
        publicKey: new Uint8Array(),
        account: parse(Address, "0x0000000000000000000000000000000000000cb1"),
        factory: parse(Address, inject("ExaAccountFactory")),
        pandaId: "card-auth-primary",
      },
      {
        id: single,
        publicKey: new Uint8Array(),
        account: parse(Address, "0x0000000000000000000000000000000000000cb2"),
        factory: parse(Address, inject("ExaAccountFactory")),
        pandaId: "card-auth-single",
      },
    ]);
  });

  afterEach(() => vi.restoreAllMocks());

  it("accepts signed cookie auth first", async () => {
    const getSession = vi.spyOn(auth.api, "getSession");
    const response = await app.request("/", {
      headers: { cookie: await serializeSigned("credential_id", "credential", authSecret), sessionid: "session" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ credentialId: "credential" });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("accepts better auth with a primary wallet address", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(session("card-auth-primary-user"));

    const response = await app.request("/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ credentialId: primary });
  });

  it("accepts better auth with one wallet address", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(session("card-auth-single-user"));

    const response = await app.request("/");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ credentialId: single });
  });

  it("accepts better auth before bearer auth", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(session("card-auth-primary-user"));

    const response = await app.request("/?scope=provisioning", {
      headers: { authorization: `Bearer ${await createToken("credential", Date.now() + 60_000)}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ credentialId: primary });
  });

  it("rejects better auth without a wallet address", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(session("card-auth-empty-user"));

    const response = await app.request("/");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("rejects better auth with ambiguous wallet addresses", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(session("card-auth-ambiguous-user"));

    const response = await app.request("/");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("rejects better auth without a credential", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(session("card-auth-missing-user"));

    const response = await app.request("/");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("accepts bearer auth for provisioning scope", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null);

    const response = await app.request("/?scope=provisioning", {
      headers: { authorization: `Bearer ${await createToken("credential", Date.now() + 60_000)}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ credentialId: "credential" });
  });

  it("accepts lowercase bearer scheme", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null);

    const response = await app.request("/?scope=provisioning", {
      headers: { authorization: `bearer ${await createToken("credential", Date.now() + 60_000)}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ credentialId: "credential" });
  });

  it("rejects bearer auth with sessionid", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null);

    const response = await app.request("/?scope=provisioning", {
      headers: {
        authorization: `Bearer ${await createToken("credential", Date.now() + 60_000)}`,
        sessionid: "session",
      },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("rejects bearer auth with mixed scopes", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null);

    const response = await app.request("/?scope=provisioning&scope=siwe", {
      headers: { authorization: `Bearer ${await createToken("credential", Date.now() + 60_000)}` },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("rejects bearer auth without provisioning scope", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null);

    const response = await app.request("/", {
      headers: { authorization: `Bearer ${await createToken("credential", Date.now() + 60_000)}` },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("rejects bearer auth with non-provisioning scope", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null);

    const response = await app.request("/?scope=siwe", {
      headers: { authorization: `Bearer ${await createToken("credential", Date.now() + 60_000)}` },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("rejects bearer auth with a bad scheme", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null);

    const response = await app.request("/?scope=provisioning", {
      headers: { authorization: `Basic ${await createToken("credential", Date.now() + 60_000)}` },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("rejects bearer auth without a token", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null);

    const response = await app.request("/?scope=provisioning", {
      headers: { authorization: "Bearer" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("rejects expired bearer auth", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null);

    const response = await app.request("/?scope=provisioning", {
      headers: { authorization: `Bearer ${await createToken("credential", Date.now() - 1)}` },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });

  it("rejects invalid bearer auth", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce(null);

    const response = await app.request("/?scope=provisioning", {
      headers: { authorization: "Bearer invalid" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized", legacy: "unauthorized" });
  });
});

function session(userId: string) {
  return {
    session: {
      activeOrganizationId: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      id: `${userId}-session`,
      ipAddress: null,
      token: `${userId}-token`,
      updatedAt: new Date(),
      userAgent: null,
      userId,
    },
    user: {
      createdAt: new Date(),
      email: `${userId}@example.com`,
      emailVerified: false,
      id: userId,
      image: null,
      name: userId,
      updatedAt: new Date(),
    },
  } satisfies NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
}
