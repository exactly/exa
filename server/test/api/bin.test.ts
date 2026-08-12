import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Supervise from "../../supervise";

const bridge = {};
const credit = { close: vi.fn<() => Promise<void>>() };
const database = { $client: { end: vi.fn<() => Promise<void>>() } };
const intercom = vi.fn();
const manteca = {};
const panda = {};
const pax = {};
const persona = {};
const sardine = {};
const segment = { close: vi.fn<() => Promise<void>>() };
const subscribe = { close: vi.fn<() => Promise<void>>() };
const walletExtension = {};
const mocks = {
  api: vi.fn<(config: Record<string, unknown>) => Hook>(),
  bridge: vi.fn<(key: string, url: string) => object>(),
  credit: vi.fn<(bullmq: object) => typeof credit>(),
  drizzle: vi.fn<() => typeof database>(),
  intercom: vi.fn<(key: string) => typeof intercom>(),
  manteca: vi.fn<(key: string, url: string) => object>(),
  panda: vi.fn<(config: { key: string; url: string }) => object>(),
  pax: vi.fn<(config: { associateKey: string; key: string; url: string }) => object>(),
  persona: vi.fn<(key: string, url: string) => object>(),
  sardine: vi.fn<(key: string, url: string) => object>(),
  secret: vi.fn<(name: string, secrets: object) => Promise<string>>(),
  segment: vi.fn<(key: string) => typeof segment>(),
  subscribe: vi.fn<(bullmq: object) => typeof subscribe>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
  walletExtension: vi.fn<(secret: string) => object>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mocks.api.mockReset().mockReturnValue({
    app: new Hono().get("/", (c) => c.json({ status: "ok" })),
    ready: Promise.resolve(),
  });
  mocks.bridge.mockReset().mockReturnValue(bridge);
  mocks.credit.mockReset().mockReturnValue(credit);
  mocks.drizzle.mockReset().mockReturnValue(database);
  mocks.intercom.mockReset().mockReturnValue(intercom);
  mocks.manteca.mockReset().mockReturnValue(manteca);
  mocks.panda.mockReset().mockReturnValue(panda);
  mocks.pax.mockReset().mockReturnValue(pax);
  mocks.persona.mockReset().mockReturnValue(persona);
  mocks.sardine.mockReset().mockReturnValue(sardine);
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
  mocks.segment.mockReset().mockReturnValue(segment);
  mocks.subscribe.mockReset().mockReturnValue(subscribe);
  mocks.supervise.mockReset();
  mocks.walletExtension.mockReset().mockReturnValue(walletExtension);
  vi.doMock("drizzle-orm/node-postgres", () => ({ drizzle: mocks.drizzle }));
  vi.doMock("ioredis", () => ({
    Redis: class {
      constructor(
        readonly redisUrl: string,
        readonly options?: { maxRetriesPerRequest: null },
      ) {}
    },
  }));
  vi.doMock("../../api", () => ({ default: mocks.api }));
  vi.doMock("../../supervise", async (importOriginal) => ({
    ...(await importOriginal<typeof Supervise>()),
    default: mocks.supervise,
  }));
  vi.doMock("../../utils/intercom", () => ({ default: mocks.intercom }));
  vi.doMock("../../utils/panda", () => ({ default: mocks.panda }));
  vi.doMock("../../utils/pax", () => ({ default: mocks.pax }));
  vi.doMock("../../utils/persona", () => ({ default: mocks.persona }));
  vi.doMock("../../utils/ramps/bridge", () => ({ default: mocks.bridge }));
  vi.doMock("../../utils/ramps/manteca", () => ({ default: mocks.manteca }));
  vi.doMock("../../utils/sardine", () => ({ default: mocks.sardine }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
  vi.doMock("../../utils/segment", () => ({ default: mocks.segment }));
  vi.doMock("../../utils/walletExtension", () => ({ default: mocks.walletExtension }));
  vi.doMock("../../workers/credit/queue", () => ({ default: mocks.credit }));
  vi.doMock("../../workers/subscribe/queue", () => ({ default: mocks.subscribe }));
});

describe("api bin", () => {
  it("resolves private config before constructing and supervising the api", async () => {
    await import("../../api/bin");
    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing api");
    const handle = await created;

    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual([
      "redis-url",
      "api-auth-secret",
      "api-bridge-api-key",
      "bridge-api-url",
      "api-postgres-url",
      "api-intercom-identity-key",
      "api-manteca-api-key",
      "manteca-api-url",
      "api-panda-api-key",
      "panda-api-url",
      "api-pax-associate-id-key",
      "api-pax-api-key",
      "pax-api-url",
      "api-persona-api-key",
      "persona-api-url",
      "api-sardine-api-key",
      "sardine-api-url",
      "api-segment-write-key",
      "api-wallet-extension-secret",
    ]);
    expect(new Set(mocks.secret.mock.calls.map(([, secrets]) => secrets)).size).toBe(1);
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith({
      authSecret: "api-auth-secret",
      bridge,
      credit,
      database,
      intercom,
      manteca,
      panda,
      pax,
      persona,
      redis: expect.objectContaining({ redisUrl: "redis-url", options: undefined }) as object,
      sardine,
      segment,
      subscribe,
      walletExtension,
    });
    const bullmq = mocks.credit.mock.calls[0]?.[0];
    expect(bullmq).toEqual(expect.objectContaining({ redisUrl: "redis-url", options: { maxRetriesPerRequest: null } }));
    expect(mocks.subscribe).toHaveBeenCalledExactlyOnceWith(bullmq);
    expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("api", created);
    const response = await handle.app.request("/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ status: "ok" });
  });
});

type Hook = {
  app: Hono;
  ready: Promise<unknown>;
};
type Handle = Hook & { close(): Promise<unknown> };
