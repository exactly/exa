/// <reference types="vite/client" />
import "../mocks/sentry";

import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { ExaAPI } from "../../api";
import type { hc } from "hono/client";

vi.mock("../../utils/wallet", () => ({ default: vi.fn() }));

afterAll(() => {
  vi.unstubAllEnvs();
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
