import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  api: vi.fn<(config: Record<string, string>) => Handle>(),
  close: vi.fn<() => Promise<void>>(),
  secret: vi.fn<(name: string) => Promise<string>>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mocks.api.mockReset().mockReturnValue({
    app: new Hono().get("/", (c) => c.json({ status: "ok" })),
    close: mocks.close,
    ready: Promise.resolve(),
  });
  mocks.close.mockReset().mockResolvedValue();
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
  mocks.supervise.mockReset();
  vi.doMock("../../api", () => ({ default: mocks.api }));
  vi.doMock("../../supervise", () => ({ default: mocks.supervise }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
});

describe("api bin", () => {
  it("resolves private config before constructing and supervising the api", async () => {
    await import("../../api/bin");
    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing api");
    const api = await created;

    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual([
      "api-alchemy-webhooks-key",
      "api-auth-secret",
      "api-bridge-api-key",
      "bridge-api-url",
      "chat-identity-key",
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
      "api-postgres-url",
      "redis-url",
      "api-sardine-api-key",
      "sardine-api-url",
      "api-segment-write-key",
      "api-wallet-extension-secret",
      "chat-whatsapp-access-token",
      "chat-whatsapp-phone-number-id",
    ]);
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith({
      alchemyKey: "api-alchemy-webhooks-key",
      authSecret: "api-auth-secret",
      bridgeKey: "api-bridge-api-key",
      bridgeUrl: "bridge-api-url",
      chatKey: "chat-identity-key",
      intercomKey: "api-intercom-identity-key",
      mantecaKey: "api-manteca-api-key",
      mantecaUrl: "manteca-api-url",
      pandaKey: "api-panda-api-key",
      pandaUrl: "panda-api-url",
      paxAssociateKey: "api-pax-associate-id-key",
      paxKey: "api-pax-api-key",
      paxUrl: "pax-api-url",
      personaKey: "api-persona-api-key",
      personaUrl: "persona-api-url",
      postgresUrl: "api-postgres-url",
      redisUrl: "redis-url",
      sardineKey: "api-sardine-api-key",
      sardineUrl: "sardine-api-url",
      segmentKey: "api-segment-write-key",
      walletExtensionSecret: "api-wallet-extension-secret",
      whatsappFrom: "chat-whatsapp-phone-number-id",
      whatsappToken: "chat-whatsapp-access-token",
    });
    expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("api", created);
    const response = await api.app.request("/");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ status: "ok" });
  });
});

type Handle = {
  app: Hono;
  close(): Promise<void>;
  ready: Promise<unknown>;
};
