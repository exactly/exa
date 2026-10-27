import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Supervise from "../../supervise";

const database = { $client: { end: vi.fn<() => Promise<void>>() } };
const mocks = {
  close: vi.fn<() => Promise<void>>(),
  drizzle: vi.fn<() => typeof database>(),
  hook: vi.fn<(config: Record<string, unknown>) => Hook>(),
  secret: vi.fn<(name: string, secrets: object) => Promise<string>>(),
  supervise: vi.fn<(name: string, created: Promise<Hook>) => void>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mocks.close.mockReset().mockResolvedValue();
  database.$client.end.mockReset().mockResolvedValue();
  mocks.drizzle.mockReset().mockReturnValue(database);
  mocks.hook.mockReset().mockReturnValue({
    app: new Hono().get("/", (c) => c.json({ status: "ok" })),
    close: mocks.close,
    ready: Promise.resolve(),
  });
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
  mocks.supervise.mockReset();
  vi.doMock("ioredis", () => ({
    Redis: class {
      constructor(
        readonly redisUrl: string,
        readonly options: { maxRetriesPerRequest: number },
      ) {}
    },
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({ drizzle: mocks.drizzle }));
  vi.doMock("../../hooks/chat", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/sponsor", () => ({ default: mocks.hook }));
  vi.doMock("../../supervise", async (importOriginal) => ({
    ...(await importOriginal<typeof Supervise>()),
    default: mocks.supervise,
  }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
});

describe("hook bin", () => {
  it.each([
    {
      config: {
        redis: expect.objectContaining({ redisUrl: "redis-url", options: { maxRetriesPerRequest: 1 } }) as object,
        whatsappFrom: "whatsapp",
        whatsappSecret: "chat-whatsapp-app-secret",
        whatsappVerifyToken: "chat-whatsapp-verify-token",
      },
      load: () => import("../../hooks/bin/chat"),
      name: "chat",
      secrets: ["redis-url", "chat-whatsapp-app-secret", "chat-whatsapp-verify-token"],
    },
    {
      config: { database, signingKey: "sponsor-token" },
      load: () => import("../../hooks/bin/sponsor"),
      name: "sponsor",
      secrets: ["sponsor-postgres-url", "sponsor-token"],
    },
  ])(
    "resolves config before constructing and supervising the $name hook",
    async ({ config, load, name, secrets: names }) => {
      await load();
      const created = mocks.supervise.mock.calls[0]?.[1];
      if (!created) throw new Error(`missing ${name} hook`);
      const createdHook = await created;

      expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual(names);
      expect(new Set(mocks.secret.mock.calls.map(([, secrets]) => secrets)).size).toBe(1);
      const response = await createdHook.app.request("/");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ status: "ok" });
      expect(mocks.hook).toHaveBeenCalledExactlyOnceWith(config);
      expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith(name, created);
    },
  );

  it("releases the database when the sponsor hook closes", async () => {
    await import("../../hooks/bin/sponsor");
    const handle = await mocks.supervise.mock.calls[0]?.[1];
    if (!handle) throw new Error("missing sponsor hook");

    await handle.close();

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(database.$client.end).toHaveBeenCalledOnce();
  });
});

type Hook = {
  app: Hono;
  close(): Promise<void>;
  ready: Promise<unknown>;
};
