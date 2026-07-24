import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  activity:
    vi.fn<(config: { alchemyKey: string; onesignalKey: string; postgresUrl: string; redisUrl: string }) => Hook>(),
  close: vi.fn<() => Promise<void>>(),
  secret: vi.fn<(name: string) => Promise<string>>(),
  supervise: vi.fn<(name: string, created: Promise<Hook>) => void>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mocks.activity.mockReset().mockReturnValue({
    app: new Hono().get("/", (c) => c.json({ status: "ok" })),
    close: mocks.close,
    ready: Promise.resolve(),
  });
  mocks.close.mockReset().mockResolvedValue();
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
  mocks.supervise.mockReset();
  vi.doMock("../../hooks/activity", () => ({ default: mocks.activity }));
  vi.doMock("../../supervise", () => ({ default: mocks.supervise }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
});

describe("activity bin", () => {
  it("resolves private config before constructing and supervising the hook", async () => {
    const app = await load();

    expect(mocks.secret.mock.calls.map(([name]) => name)).toStrictEqual([
      "activity-alchemy-webhooks-key",
      "activity-onesignal-api-key",
      "activity-postgres-url",
      "redis-url",
    ]);
    const response = await app.request("/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ status: "ok" });
    expect(mocks.activity).toHaveBeenCalledExactlyOnceWith({
      alchemyKey: "activity-alchemy-webhooks-key",
      onesignalKey: "activity-onesignal-api-key",
      postgresUrl: "activity-postgres-url",
      redisUrl: "redis-url",
    });
  });
});

async function load() {
  await import("../../hooks/bin/activity");
  const created = mocks.supervise.mock.calls[0]?.[1];
  if (!created) throw new Error("missing activity hook");
  const hook = await created;
  expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("activity", created);
  return hook.app;
}

type Hook = {
  app: Hono;
  close(): Promise<void>;
  ready: Promise<unknown>;
};
