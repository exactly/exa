import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  close: vi.fn<() => Promise<void>>(),
  hook: vi.fn<(config: Record<string, string>) => Hook>(),
  secret: vi.fn<(name: string) => Promise<string>>(),
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
  vi.doMock("../../hooks/activity", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/block", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/bridge", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/manteca", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/panda", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/persona", () => ({ default: mocks.hook }));
  vi.doMock("../../supervise", () => ({ default: mocks.supervise }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
});

describe("hook bin", () => {
  it.each([
    {
      config: {
        alchemyKey: "activity-alchemy-webhooks-key",
        onesignalKey: "activity-onesignal-api-key",
        postgresUrl: "activity-postgres-url",
        redisUrl: "redis-url",
      },
      load: () => import("../../hooks/bin/activity"),
      name: "activity",
      secrets: ["activity-alchemy-webhooks-key", "activity-onesignal-api-key", "activity-postgres-url", "redis-url"],
    },
    {
      config: {
        alchemyKey: "block-alchemy-webhooks-key",
        onesignalKey: "block-onesignal-api-key",
        redisUrl: "redis-url",
      },
      load: () => import("../../hooks/bin/block"),
      name: "block",
      secrets: ["block-alchemy-webhooks-key", "block-onesignal-api-key", "redis-url"],
    },
    {
      config: {
        bridgeKey: "bridge-bridge-api-key",
        bridgeUrl: "bridge-api-url",
        onesignalKey: "bridge-onesignal-api-key",
        personaKey: "bridge-persona-api-key",
        personaUrl: "persona-api-url",
        postgresUrl: "bridge-postgres-url",
        segmentKey: "bridge-segment-write-key",
      },
      load: () => import("../../hooks/bin/bridge"),
      name: "bridge",
      secrets: [
        "bridge-bridge-api-key",
        "bridge-api-url",
        "bridge-onesignal-api-key",
        "bridge-persona-api-key",
        "persona-api-url",
        "bridge-postgres-url",
        "bridge-segment-write-key",
      ],
    },
    {
      config: {
        mantecaKey: "manteca-manteca-api-key",
        mantecaUrl: "manteca-api-url",
        mantecaWebhookKey: "manteca-webhooks-key",
        onesignalKey: "manteca-onesignal-api-key",
        postgresUrl: "manteca-postgres-url",
        segmentKey: "manteca-segment-write-key",
      },
      load: () => import("../../hooks/bin/manteca"),
      name: "manteca",
      secrets: [
        "manteca-manteca-api-key",
        "manteca-api-url",
        "manteca-webhooks-key",
        "manteca-onesignal-api-key",
        "manteca-postgres-url",
        "manteca-segment-write-key",
      ],
    },
    {
      config: {
        issuerKey: "panda-issuer-private-key",
        onesignalKey: "panda-onesignal-api-key",
        pandaKey: "panda-panda-api-key",
        pandaUrl: "panda-api-url",
        postgresUrl: "panda-postgres-url",
        redisUrl: "redis-url",
        sardineKey: "panda-sardine-api-key",
        sardineUrl: "sardine-api-url",
        segmentKey: "panda-segment-write-key",
      },
      load: () => import("../../hooks/bin/panda"),
      name: "panda",
      secrets: [
        "panda-issuer-private-key",
        "panda-onesignal-api-key",
        "panda-panda-api-key",
        "panda-api-url",
        "panda-postgres-url",
        "redis-url",
        "panda-sardine-api-key",
        "sardine-api-url",
        "panda-segment-write-key",
      ],
    },
    {
      config: {
        pandaKey: "persona-panda-api-key",
        pandaUrl: "panda-api-url",
        paxAssociateKey: "persona-pax-associate-id-key",
        paxKey: "persona-pax-api-key",
        paxUrl: "pax-api-url",
        personaKey: "persona-persona-api-key",
        personaUrl: "persona-api-url",
        personaWebhookSecret: "persona-persona-webhook-secret",
        postgresUrl: "persona-postgres-url",
        redisUrl: "redis-url",
        sardineKey: "persona-sardine-api-key",
        sardineUrl: "sardine-api-url",
      },
      load: () => import("../../hooks/bin/persona"),
      name: "persona",
      secrets: [
        "persona-panda-api-key",
        "panda-api-url",
        "persona-pax-associate-id-key",
        "persona-pax-api-key",
        "pax-api-url",
        "persona-persona-api-key",
        "persona-api-url",
        "persona-persona-webhook-secret",
        "persona-postgres-url",
        "redis-url",
        "persona-sardine-api-key",
        "sardine-api-url",
      ],
    },
  ])(
    "resolves private config before constructing and supervising the $name hook",
    async ({ config, load, name, secrets }) => {
      await load();
      const created = mocks.supervise.mock.calls[0]?.[1];
      if (!created) throw new Error(`missing ${name} hook`);
      const hook = await created;

      expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual(secrets);
      const response = await hook.app.request("/");
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
