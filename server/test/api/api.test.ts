/// <reference types="vite/client" />
import "../mocks/sentry";

import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { ExaAPI } from "../../api";
import type { hc, InferResponseType } from "hono/client";

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
  });

  it("preserves every client response type", () => {
    expectTypeOf<AnyResponses<ReturnType<typeof hc<ExaAPI>>>>().toBeNever();
    expectTypeOf<InferResponseType<ReturnType<typeof hc<ExaAPI>>["chat"]["$get"]>>().toEqualTypeOf<{
      code: string;
    }>();
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
