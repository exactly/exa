import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  close: vi.fn<() => Promise<void>>(),
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
        readonly options: { maxRetriesPerRequest: null },
      ) {}
    },
  }));
  vi.doMock("../../hooks/chat", () => ({ default: mocks.hook }));
  vi.doMock("../../supervise", () => ({ default: mocks.supervise }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
});

describe("hook bin", () => {
  it.each([
    {
      config: {
        bullmq: expect.objectContaining({ redisUrl: "redis-url", options: { maxRetriesPerRequest: null } }) as object,
        close: expect.any(Function) as () => Promise<unknown>,
        whatsappFrom: "whatsapp-phone-number-id",
        whatsappSecret: "chat-whatsapp-app-secret",
        whatsappVerifyToken: "chat-whatsapp-verify-token",
      },
      load: () => import("../../hooks/bin/chat"),
      name: "chat",
      secrets: ["redis-url", "whatsapp-phone-number-id", "chat-whatsapp-app-secret", "chat-whatsapp-verify-token"],
    },
  ])(
    "resolves private config before constructing and supervising the $name hook",
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
});

type Hook = {
  app: Hono;
  close(): Promise<void>;
  ready: Promise<unknown>;
};
