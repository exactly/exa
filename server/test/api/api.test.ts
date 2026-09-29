/// <reference types="vite/client" />
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import assert from "node:assert";
import { createHmac } from "node:crypto";
import { env } from "node:process";
import { object, parse, string } from "valibot";
import { padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, onTestFinished, vi } from "vitest";

import chain from "@exactly/common/generated/chain";

import database, { organizations, sources, users } from "../../database";
import authSecret from "../../utils/authSecret";

import type { ExaAPI } from "../../api";
import type { hc } from "hono/client";

vi.mock("../../utils/wallet", () => ({ default: vi.fn() }));
vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn().mockResolvedValue(["1.1.1.1"]),
  resolve6: vi.fn().mockResolvedValue([]),
}));

afterAll(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("@exactly/common/domain");
  vi.resetModules();
  vi.clearAllMocks();
});

beforeAll(() => {
  vi.resetModules();
  for (const name of Object.keys(env)) vi.stubEnv(name, undefined); // eslint-disable-line unicorn/no-useless-undefined
});

describe("api", () => {
  it("loads the factory without environment variables", async () => {
    await expect(import("../../api").then(({ default: api }) => api)).resolves.toBeTypeOf("function");
    const { default: origin, origins } = await import("../../utils/appOrigin");
    expect(origins).toStrictEqual([origin]);
  });

  it("resolves only configured frontend origins, including behind a tls proxy", async () => {
    vi.stubEnv("APP_ORIGINS", "https://secondary.example");
    vi.resetModules();
    const { default: appOrigin, origin, origins } = await import("../../utils/appOrigin");

    expect(origins).toStrictEqual([appOrigin, "https://secondary.example"]);
    expect(origin(new Request("http://secondary.example/api"))).toBe("https://secondary.example");
    expect(origin(new Request("http://internal/api", { headers: { origin: "https://secondary.example" } }))).toBe(
      "https://secondary.example",
    );
    expect(origin(new Request("http://internal/api"))).toBe(appOrigin);
    expect(origin(new Request("http://internal/api", { headers: { origin: "https://untrusted.example" } }))).toBe(
      appOrigin,
    );
  });

  it("uses the localhost frontend authority without an origin header", async () => {
    vi.stubEnv("APP_ORIGINS", "");
    vi.doMock("@exactly/common/domain", () => ({ default: "localhost" }));
    vi.resetModules();
    try {
      const { default: appOrigin, origin, origins } = await import("../../utils/appOrigin");
      expect(appOrigin).toBe("http://localhost:8081");
      expect(origins).toStrictEqual([appOrigin]);
      expect(origin(new Request("http://internal/api"))).toBe(appOrigin);
    } finally {
      vi.doUnmock("@exactly/common/domain");
      vi.resetModules();
    }
  });

  it.each(["", "  ", " , , "])("ignores empty configured origins: %j", async (value) => {
    vi.stubEnv("APP_ORIGINS", value);
    vi.resetModules();
    const { default: appOrigin, origins } = await import("../../utils/appOrigin");
    expect(origins).toStrictEqual([appOrigin]);
  });

  it("normalizes and deduplicates configured origins", async () => {
    const { default: appOrigin } = await import("../../utils/appOrigin");
    vi.stubEnv(
      "APP_ORIGINS",
      ` ${appOrigin}/, HTTPS://SECONDARY.example:443/, https://user:password@secondary.example/app?query=value#fragment, http://localhost:8081/, https://secondary.example:8443/, , `,
    );
    vi.resetModules();
    const { origin, origins } = await import("../../utils/appOrigin");

    expect(origins).toStrictEqual([
      appOrigin,
      "https://secondary.example",
      "http://localhost:8081",
      "https://secondary.example:8443",
    ]);
    expect(origin(new Request("http://internal/api", { headers: { origin: "https://secondary.example" } }))).toBe(
      "https://secondary.example",
    );
  });

  it.each(["invalid", "https://secondary.example:invalid", "file:///frontend"])(
    "rejects invalid configured origins: %s",
    async (value) => {
      vi.stubEnv("APP_ORIGINS", value);
      vi.resetModules();
      await expect(import("../../utils/appOrigin")).rejects.toThrow();
    },
  );

  it.each(["localhost", "sandbox.exactly.app"])(
    "keeps integrator authentication on primary domain %s",
    async (domain) => {
      vi.stubEnv("APP_ORIGINS", "https://secondary.example");
      vi.doMock("@exactly/common/domain", () => ({ default: domain }));
      vi.resetModules();
      const [{ default: api }, authentication, { default: origin }, { default: client }] = await Promise.all([
        import("../../api"),
        import("../../utils/auth"),
        import("../../utils/appOrigin"),
        import("../../utils/publicClient"),
      ]);
      const auth = authentication.default(database, authSecret);
      const context = await auth.$context;
      vi.spyOn(authentication, "default").mockReturnValue(auth);
      const app = new Hono().route(
        "/api",
        api({
          authSecret,
          database,
          bridge: undefined as never,
          credit: undefined as never,
          intercom: undefined as never,
          manteca: undefined as never,
          panda: undefined as never,
          pax: undefined as never,
          persona: undefined as never,
          redis: undefined as never,
          sardine: undefined as never,
          segment: undefined as never,
          subscribe: undefined as never,
          walletExtension: undefined as never,
        }).app,
      );

      expect(authentication.default).toHaveBeenCalledExactlyOnceWith(database, authSecret);
      expect(auth.options.baseURL).toBe(origin);
      expect(auth.options.trustedOrigins).toStrictEqual([origin]);
      expect(auth.options.plugins.find((plugin) => plugin.id === "siwe")?.options.domain).toBe(new URL(origin).host);
      const account = privateKeyToAccount(padHex("0xa11ce"));
      const nonce = await app.request(`${origin}/api/auth/siwe/nonce`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ walletAddress: account.address, chainId: chain.id }),
      });
      expect(nonce.status).toBe(200);
      const message = createSiweMessage({
        address: account.address,
        chainId: chain.id,
        domain: "secondary.example",
        nonce: parse(object({ nonce: string() }), await nonce.json()).nonce,
        scheme: "https",
        uri: "https://secondary.example",
        version: "1",
      });
      vi.spyOn(client, "verifyMessage").mockResolvedValue(false);
      const secondary = await app.request(`${origin}/api/auth/siwe/verify`, {
        method: "POST",
        headers: { origin: "https://secondary.example", "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: account.address,
          chainId: chain.id,
          message,
          signature: await account.signMessage({ message }),
        }),
      });
      expect(secondary.status).toBe(401);
      await expect(secondary.json()).resolves.toStrictEqual({
        code: "UNAUTHORIZED_SIWE_MESSAGE_MISMATCH",
        message: "Unauthorized: SIWE message does not match the expected nonce, domain, address, or chain ID",
        status: 401,
      });
      expect(client.verifyMessage).not.toHaveBeenCalled();
      const user = await context.internalAdapter.createUser({
        name: "origin",
        email: `${crypto.randomUUID()}@example.com`,
        emailVerified: true,
      });
      onTestFinished(async () => {
        await database.delete(users).where(eq(users.id, user.id));
      });
      const session = await context.internalAdapter.createSession(user.id);
      assert.ok(session);
      const signature = createHmac("sha256", authSecret).update(session.token).digest("base64");
      const headers = new Headers({
        origin,
        cookie: `${context.authCookies.sessionToken.name}=${encodeURIComponent(`${session.token}.${signature}`)}`,
      });
      const organization = await auth.api.createOrganization({
        headers,
        body: { name: "origin", slug: crypto.randomUUID() },
      });
      assert.ok(organization);
      onTestFinished(async () => {
        await database.delete(sources).where(eq(sources.id, organization.id));
        await database.delete(organizations).where(eq(organizations.id, organization.id));
      });

      const cookies = new Headers(headers);
      cookies.delete("origin");
      for (const options of [{ headers }, { headers: cookies }]) {
        const login = await app.request(`${origin}/api/auth/get-session`, options);
        expect(login.status).toBe(200);
        await expect(login.json()).resolves.toStrictEqual(
          await Response.json(await auth.api.getSession(options)).json(),
        );

        const empty = await app.request(`${origin}/api/webhook`, options);
        expect(empty.status).toBe(200);
        await expect(empty.json()).resolves.toStrictEqual({});
      }

      const post = await app.request(`${origin}/api/webhook/test`, {
        method: "POST",
        headers: new Headers({ ...Object.fromEntries(headers), "content-type": "application/json" }),
        body: JSON.stringify({ url: "https://example.com" }),
      });
      expect(post.status).toBe(201);
      const created = parse(object({ name: string(), url: string(), secret: string() }), await post.json());
      expect(created).toStrictEqual({
        name: "test",
        url: "https://example.com",
        secret: expect.stringMatching(/^[\da-f]{64}$/) as unknown,
      });
      expect(await database.query.sources.findFirst({ where: eq(sources.id, organization.id) })).toStrictEqual({
        id: organization.id,
        config: { type: "integrator", webhooks: { test: { url: created.url, secret: created.secret } } },
      });

      const patch = await app.request(`${origin}/api/webhook/test`, {
        method: "PATCH",
        headers: new Headers({ ...Object.fromEntries(headers), "content-type": "application/json" }),
        body: JSON.stringify({ url: "https://updated.example.com" }),
      });
      expect(patch.status).toBe(200);
      await expect(patch.json()).resolves.toStrictEqual({ name: "test", url: "https://updated.example.com" });
      const get = await app.request(`${origin}/api/webhook/test`, { headers });
      expect(get.status).toBe(200);
      await expect(get.json()).resolves.toStrictEqual({ url: "https://updated.example.com" });
      const remove = await app.request(`${origin}/api/webhook/test`, { method: "DELETE", headers });
      expect(remove.status).toBe(200);
      await expect(remove.json()).resolves.toStrictEqual({ code: "ok" });
      expect(await database.query.sources.findFirst({ where: eq(sources.id, organization.id) })).toBeUndefined();

      const unauthorized = await app.request("http://internal/api/webhook");
      expect(unauthorized.status).toBe(401);
      await expect(unauthorized.json()).resolves.toStrictEqual({ code: "unauthorized" });
      expect(captureException).not.toHaveBeenCalled();
    },
  );

  it("preserves every client response type", () => {
    expectTypeOf<AnyResponses<ReturnType<typeof hc<ExaAPI>>>>().toBeNever();
  });
});

type AnyResponses<Client, Path extends string = ""> = {
  [Key in keyof Client & string]: Key extends `$${string}`
    ? Client[Key] extends (...parameters: never[]) => Promise<infer Response>
      ? AnyOutput<Response, `${Path}${Key}`>
      : never
    : Client[Key] extends object
      ? AnyResponses<Client[Key], `${Path}/${Key}`>
      : never;
}[keyof Client & string];

type AnyOutput<Response, Path extends string> = Response extends { json(): Promise<infer Output> }
  ? boolean extends (Output extends never ? true : false)
    ? Path
    : never
  : never;
