/// <reference types="vite/client" />
import "../mocks/sentry";

import { env } from "node:process";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import type { ExaAPI } from "../../api";
import type createCredit from "../../workers/credit/queue";
import type createSubscribe from "../../workers/subscribe/queue";
import type { hc } from "hono/client";

const mocks = vi.hoisted(() => ({
  closeCredit: vi.fn<ReturnType<typeof createCredit>["close"]>(),
  closeSubscribe: vi.fn<ReturnType<typeof createSubscribe>["close"]>(),
  createCredit: vi.fn<typeof createCredit>(),
  createSubscribe: vi.fn<typeof createSubscribe>(),
  enqueueCredit: vi.fn<ReturnType<typeof createCredit>["enqueue"]>(),
  enqueueSubscribe: vi.fn<ReturnType<typeof createSubscribe>["enqueue"]>(),
  quit: vi.fn<() => Promise<"OK">>(),
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
vi.mock("../../workers/credit/queue", () => ({
  default: mocks.createCredit,
}));
vi.mock("../../workers/subscribe/queue", () => ({
  default: mocks.createSubscribe,
}));

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeAll(() => {
  vi.resetModules();
  for (const name of Object.keys(env)) vi.stubEnv(name, undefined); // eslint-disable-line unicorn/no-useless-undefined
});

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.closeCredit.mockReset().mockResolvedValue();
  mocks.closeSubscribe.mockReset().mockResolvedValue();
  mocks.createCredit.mockReset().mockReturnValue({ close: mocks.closeCredit, enqueue: mocks.enqueueCredit });
  mocks.createSubscribe.mockReset().mockReturnValue({ close: mocks.closeSubscribe, enqueue: mocks.enqueueSubscribe });
  mocks.enqueueCredit.mockReset().mockResolvedValue();
  mocks.enqueueSubscribe.mockReset().mockResolvedValue();
  mocks.quit.mockReset().mockResolvedValue("OK");
  mocks.redis.mockReset();
});

describe("api", () => {
  it("loads the factory without environment variables", async () => {
    await expect(import("../../api").then(({ default: api }) => api)).resolves.toBeTypeOf("function");
  });

  it("closes queue resources once", async () => {
    const end = vi.spyOn(Pool.prototype, "end");
    const handle = await create();

    const closing = handle.close();
    expect(handle.close()).toBe(closing);
    await closing;

    expect(mocks.closeCredit).toHaveBeenCalledOnce();
    expect(mocks.closeSubscribe).toHaveBeenCalledOnce();
    expect(mocks.createCredit).toHaveBeenCalledOnce();
    expect(mocks.createSubscribe).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(mocks.enqueueCredit).not.toHaveBeenCalled();
    expect(mocks.enqueueSubscribe).not.toHaveBeenCalled();
    expect(mocks.quit).toHaveBeenCalledTimes(2);
    expect(mocks.redis.mock.calls).toStrictEqual([
      ["redis://localhost:8479"],
      ["redis://localhost:8479", { maxRetriesPerRequest: null }],
    ]);
  });

  it("quits bullmq when a queue fails to close", async () => {
    const error = new Error("credit close failed");
    mocks.closeCredit.mockRejectedValueOnce(error);
    const end = vi.spyOn(Pool.prototype, "end");
    const handle = await create();

    const closing = handle.close();
    expect(handle.close()).toBe(closing);
    await expect(closing).rejects.toBe(error);

    expect(mocks.closeCredit).toHaveBeenCalledOnce();
    expect(mocks.closeSubscribe).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(mocks.quit).toHaveBeenCalledTimes(2);
  });

  it("preserves every client response type", () => {
    expectTypeOf<AnyResponses<ReturnType<typeof hc<ExaAPI>>>>().toBeNever();
  });
});

async function create() {
  const { default: api } = await import("../../api");
  return api({
    alchemyKey: "alchemy",
    authSecret: "auth-secret-auth-secret-auth-secret",
    bridgeKey: "bridge",
    bridgeUrl: "https://bridge.test",
    chatKey: "chat",
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
    whatsappFrom: "whatsapp",
    whatsappToken: "whatsapp",
  });
}

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
