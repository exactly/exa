import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  allow: vi.fn<(config: { redisUrl: string }) => Handle>(),
  close: vi.fn<() => Promise<void>>(),
  credit: vi.fn<(config: { onesignalKey: string; postgresUrl: string; redisUrl: string }) => Handle>(),
  poke: vi.fn<(config: { onesignalKey: string; redisUrl: string; segmentKey: string }) => Handle>(),
  secret: vi.fn<(name: string) => Promise<string>>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
  subscribe: vi.fn<(config: { alchemyKey: string; redisUrl: string }) => Handle>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mocks.allow.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.close.mockReset().mockResolvedValue();
  mocks.credit.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.poke.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
  mocks.supervise.mockReset();
  mocks.subscribe.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  vi.doMock("../../supervise", () => ({ default: mocks.supervise }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
  vi.doMock("../../workers/allow/worker", () => ({ default: mocks.allow }));
  vi.doMock("../../workers/credit/worker", () => ({ default: mocks.credit }));
  vi.doMock("../../workers/poke/worker", () => ({ default: mocks.poke }));
  vi.doMock("../../workers/subscribe/worker", () => ({ default: mocks.subscribe }));
});

describe("bin", () => {
  it.each([
    {
      config: { redisUrl: "redis-url" },
      load: () => import("../../workers/allow/bin"),
      name: "allow",
      worker: mocks.allow,
    },
    {
      config: {
        onesignalKey: "credit-onesignal-api-key",
        postgresUrl: "credit-postgres-url",
        redisUrl: "redis-url",
      },
      load: () => import("../../workers/credit/bin"),
      name: "credit",
      worker: mocks.credit,
    },
    {
      config: { onesignalKey: "poke-onesignal-api-key", redisUrl: "redis-url", segmentKey: "poke-segment-write-key" },
      load: () => import("../../workers/poke/bin"),
      name: "poke",
      worker: mocks.poke,
    },
    {
      config: { alchemyKey: "subscribe-alchemy-webhooks-key", redisUrl: "redis-url" },
      load: () => import("../../workers/subscribe/bin"),
      name: "subscribe",
      worker: mocks.subscribe,
    },
  ])(
    "resolves $name private config before constructing and supervising its worker",
    async ({ config, load, name, worker }) => {
      await load();

      const created = mocks.supervise.mock.calls[0]?.[1];
      if (!created) throw new Error("missing worker");
      expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith(name, created);
      await created;
      expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual(Object.values(config));
      expect(worker).toHaveBeenCalledExactlyOnceWith(config);
    },
  );
});

type Handle = {
  close(): Promise<void>;
  ready: Promise<void>;
};
