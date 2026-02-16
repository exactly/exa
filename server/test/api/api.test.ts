/// <reference types="vite/client" />
import "../mocks/sentry";

import { env } from "node:process";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { ExaAPI } from "../../api";
import type createSubscribe from "../../workers/subscribe/queue";
import type { hc } from "hono/client";

const mocks = vi.hoisted(() => ({
  close: vi.fn<ReturnType<typeof createSubscribe>["close"]>().mockResolvedValue(),
  createSubscribe: vi.fn<typeof createSubscribe>(),
  enqueue: vi.fn<ReturnType<typeof createSubscribe>["enqueue"]>().mockResolvedValue(),
  quit: vi.fn<() => Promise<"OK">>().mockResolvedValue("OK"),
  redis: vi.fn<(url: string, options?: { maxRetriesPerRequest: null }) => void>(),
}));

vi.mock("ioredis", () => ({
  Redis: class {
    constructor(...parameters: Parameters<typeof mocks.redis>) {
      mocks.redis(...parameters);
    }

    quit = mocks.quit;
  },
}));
vi.mock("../../utils/wallet", () => ({ default: vi.fn() }));
vi.mock("../../workers/subscribe/queue", () => ({
  default: mocks.createSubscribe.mockReturnValue({ close: mocks.close, enqueue: mocks.enqueue }),
}));

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

  it("closes subscription resources once", async () => {
    const end = vi.spyOn(Pool.prototype, "end");
    const { default: api } = await import("../../api");
    const handle = api({
      alchemyKey: "alchemy",
      authSecret: "auth-secret-auth-secret-auth-secret",
      bridgeKey: "bridge",
      bridgeUrl: "https://bridge.test",
      intercomKey: "intercom",
      mantecaKey: "manteca",
      mantecaUrl: "https://manteca.test",
      pandaKey: "panda",
      pandaUrl: "https://panda.test",
      paxAssociateKey: "pax",
      paxKey: "pax",
      paxUrl: "https://pax.test",
      personaKey: "persona",
      personaUrl: "https://persona.test",
      postgresUrl: "postgres://postgres:postgres@localhost:8432/postgres?sslmode=disable", // cspell:ignore sslmode
      redisUrl: "redis://localhost:8479",
      sardineKey: "sardine",
      sardineUrl: "https://sardine.test",
      segmentKey: "segment",
      walletExtensionSecret: "wallet-extension-secret-32-bytes",
    });

    const closing = handle.close();
    expect(handle.close()).toBe(closing);
    await closing;

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.createSubscribe).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.quit).toHaveBeenCalledTimes(2);
    expect(mocks.redis.mock.calls).toStrictEqual([
      ["redis://localhost:8479"],
      ["redis://localhost:8479", { maxRetriesPerRequest: null }],
    ]);
  });

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
