import "../mocks/sentry";

import { captureException, close as closeSentry } from "@sentry/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  allow: vi.fn<(config: { redisUrl: string }) => Handle>(),
  close: vi.fn<() => Promise<void>>(),
  credit: vi.fn<(config: { onesignalKey: string; postgresUrl: string; redisUrl: string }) => Handle>(),
  exit: vi.fn<(code?: null | number | string) => void>(),
  poke: vi.fn<(config: { onesignalKey: string; redisUrl: string; segmentKey: string }) => Handle>(),
  refund: vi.fn<(config: { pandaKey: string; pandaUrl: string; redisUrl: string }) => Handle>(),
  once: vi.fn<(event: string | symbol) => void>(),
  secret: vi.fn<(name: string) => Promise<string>>(),
  subscribe: vi.fn<(config: { alchemyKey: string; redisUrl: string }) => Handle>(),
};
const listeners = new Map<string, () => void>();

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe("bin", () => {
  beforeEach(() => {
    vi.resetModules();
    listeners.clear();
    process.exitCode = undefined;
    mocks.allow.mockReset();
    mocks.close.mockReset().mockResolvedValue();
    mocks.credit.mockReset();
    mocks.exit.mockReset();
    mocks.once.mockReset();
    mocks.poke.mockReset();
    mocks.refund.mockReset();
    mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
    mocks.subscribe.mockReset();
    vi.mocked(captureException).mockReset();
    vi.mocked(closeSentry).mockReset().mockResolvedValue(true);
    for (const worker of [mocks.allow, mocks.credit, mocks.poke, mocks.refund, mocks.subscribe]) {
      worker.mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
    }
    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      mocks.once(event);
      listeners.set(String(event), () => listener());
      return process;
    });
    vi.spyOn(process, "exit").mockImplementation((code) => {
      mocks.exit(code);
      return undefined as never;
    });
    vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
    vi.doMock("../../workers/allow/worker", () => ({ default: mocks.allow }));
    vi.doMock("../../workers/credit/worker", () => ({ default: mocks.credit }));
    vi.doMock("../../workers/poke/worker", () => ({ default: mocks.poke }));
    vi.doMock("../../workers/refund/worker", () => ({ default: mocks.refund }));
    vi.doMock("../../workers/subscribe/worker", () => ({ default: mocks.subscribe }));
  });

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
      config: { pandaKey: "refund-panda-api-key", pandaUrl: "panda-api-url", redisUrl: "redis-url" },
      load: () => import("../../workers/refund/bin"),
      name: "refund",
      worker: mocks.refund,
    },
    {
      config: { alchemyKey: "account-alchemy-webhooks-key", redisUrl: "redis-url" },
      load: () => import("../../workers/subscribe/bin"),
      name: "subscribe",
      worker: mocks.subscribe,
    },
  ])("resolves $name private config before constructing its worker", async ({ config, load, worker }) => {
    await load();
    await vi.waitFor(() => expect(worker).toHaveBeenCalledOnce());

    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual(Object.values(config));
    expect(worker).toHaveBeenCalledExactlyOnceWith(config);
    expect(mocks.once).toHaveBeenCalledTimes(2);

    signal("SIGTERM");
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0));
    signal("SIGINT");

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(closeSentry).toHaveBeenCalledOnce();
    expect(mocks.exit).toHaveBeenCalledOnce();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("captures startup failures before closing", async () => {
    const error = new Error("startup failed");
    const { default: bin } = await import("../../workers/bin");

    bin("test", Promise.resolve({ close: mocks.close, ready: Promise.reject(error) }));

    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "fatal",
      tags: { startup: true, worker: "test" },
    });
    expect(process.exitCode).toBe(1);
    expect(closeSentry).toHaveBeenCalledOnce();
    expect(mocks.exit).not.toHaveBeenCalled();
  });

  it("captures close failures before exiting", async () => {
    const error = new Error("close failed");
    mocks.close.mockRejectedValueOnce(error);
    const { default: bin } = await import("../../workers/bin");
    bin("test", Promise.resolve({ close: mocks.close, ready: Promise.resolve() }));

    signal("SIGTERM");

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "fatal",
      tags: { close: true, worker: "test" },
    });
    expect(closeSentry).toHaveBeenCalledOnce();
  });
});

function signal(name: "SIGINT" | "SIGTERM") {
  const listener = listeners.get(name);
  if (!listener) throw new Error(`missing ${name} listener`);
  listener();
}

type Handle = {
  close(): Promise<void>;
  ready: Promise<void>;
};
