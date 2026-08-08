import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  close: vi.fn<() => Promise<void>>(),
  secret: vi.fn<(name: string) => Promise<string>>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
  subscribe: vi.fn<(config: { alchemyKey: string; redisUrl: string }) => Handle>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mocks.close.mockReset().mockResolvedValue();
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
  mocks.supervise.mockReset();
  mocks.subscribe.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  vi.doMock("../../supervise", () => ({ default: mocks.supervise }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
  vi.doMock("../../workers/subscribe/worker", () => ({ default: mocks.subscribe }));
});

describe("bin", () => {
  it("resolves private config before constructing and supervising its worker", async () => {
    await import("../../workers/subscribe/bin");

    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");
    expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("subscribe", created);
    await created;
    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual([
      "account-alchemy-webhooks-key",
      "redis-url",
    ]);
    expect(mocks.subscribe).toHaveBeenCalledExactlyOnceWith({
      alchemyKey: "account-alchemy-webhooks-key",
      redisUrl: "redis-url",
    });
  });
});

type Handle = {
  close(): Promise<void>;
  ready: Promise<void>;
};
