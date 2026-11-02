import { Hono } from "hono";
import { Redis } from "ioredis";
import { env } from "node:process";
import { padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Supervise from "../../supervise";

const account = privateKeyToAccount(padHex("0x69"));
const issuer = privateKeyToAccount(padHex("0x420"));
const alchemy = {};
const bridge = {};
const database = { $client: { end: vi.fn<() => Promise<void>>() } };
const manteca = {};
const onesignal = {};
const panda = {};
const pax = {};
const persona = {};
const sardine = {};
const segment = { close: vi.fn<() => Promise<void>>() };
if (!env.REDIS_URL) throw new Error("missing redis url");
const redisUrl = env.REDIS_URL;
const queue = expect.objectContaining({
  close: expect.any(Function) as unknown,
  enqueue: expect.any(Function) as unknown,
}) as object;
const mocks = {
  alchemy: vi.fn<(key: string) => object>(),
  bridge: vi.fn<(key: string, url: string) => object>(),
  closeSecrets: vi.fn<() => Promise<void>>(),
  drizzle: vi.fn<() => typeof database>(),
  hook: vi.fn<(config: Record<string, unknown>) => Handle>(),
  manteca: vi.fn<(key: string, url: string) => object>(),
  onesignal: vi.fn<(key: string) => object>(),
  panda: vi.fn<(config: { key: string; url: string }) => object>(),
  pax: vi.fn<(config: { associateKey: string; key: string; url: string }) => object>(),
  persona: vi.fn<(key: string, url: string) => object>(),
  sardine: vi.fn<(key: string, url: string) => object>(),
  secret: vi.fn<(name: string, secrets: object) => Promise<string>>(),
  segment: vi.fn<(key: string) => typeof segment>(),
  signer: vi.fn<(name: string, kms: object) => Promise<typeof account>>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  database.$client.end.mockReset().mockResolvedValue();
  segment.close.mockReset();
  mocks.alchemy.mockReset().mockReturnValue(alchemy);
  mocks.bridge.mockReset().mockReturnValue(bridge);
  mocks.closeSecrets.mockReset().mockResolvedValue();
  mocks.drizzle.mockReset().mockReturnValue(database);
  mocks.hook.mockReset().mockReturnValue({
    app: new Hono().get("/", (c) => c.json({ status: "ok" })),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(),
    ready: Promise.resolve(),
  });
  mocks.manteca.mockReset().mockReturnValue(manteca);
  mocks.onesignal.mockReset().mockReturnValue(onesignal);
  mocks.panda.mockReset().mockReturnValue(panda);
  mocks.pax.mockReset().mockReturnValue(pax);
  mocks.persona.mockReset().mockReturnValue(persona);
  mocks.sardine.mockReset().mockReturnValue(sardine);
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name === "redis-url" ? redisUrl : name));
  mocks.segment.mockReset().mockReturnValue(segment);
  mocks.signer.mockReset().mockImplementation((name) => Promise.resolve(name === "issuer" ? issuer : account));
  mocks.supervise.mockReset();
  vi.doMock("@google-cloud/secret-manager", () => ({
    SecretManagerServiceClient: class {
      close = mocks.closeSecrets;
    },
  }));
  vi.doMock("drizzle-orm/node-postgres", () => ({ drizzle: mocks.drizzle }));
  vi.doMock("../../hooks/activity", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/block", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/bridge", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/chat", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/manteca", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/panda", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/persona", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/sponsor", () => ({ default: mocks.hook }));
  vi.doMock("../../supervise", async (importOriginal) => ({
    ...(await importOriginal<typeof Supervise>()),
    default: mocks.supervise,
  }));
  vi.doMock("../../utils/alchemy", () => ({ default: mocks.alchemy }));
  vi.doMock("../../utils/onesignal", () => ({ default: mocks.onesignal }));
  vi.doMock("../../utils/panda", () => ({ default: mocks.panda }));
  vi.doMock("../../utils/pax", () => ({ default: mocks.pax }));
  vi.doMock("../../utils/persona", () => ({ default: mocks.persona }));
  vi.doMock("../../utils/ramps/bridge", () => ({ default: mocks.bridge }));
  vi.doMock("../../utils/ramps/manteca", () => ({ default: mocks.manteca }));
  vi.doMock("../../utils/sardine", () => ({ default: mocks.sardine }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
  vi.doMock("../../utils/segment", () => ({ default: mocks.segment }));
  vi.doMock("../../utils/wallet", () => ({ signer: mocks.signer }));
});

describe("hook bin", () => {
  it.each([
    {
      accounts: [],
      config: {
        alchemy,
        database,
        onesignal,
        poke: queue,
        redis: expect.any(Redis) as Redis,
      },
      load: () => import("../../hooks/bin/activity"),
      name: "activity",
      secrets: ["activity-alchemy-webhooks-key", "activity-postgres-url", "activity-onesignal-api-key", "redis-url"],
    },
    {
      accounts: ["executor"],
      config: {
        alchemy,
        blockKey: "block-alchemy-block-key",
        database,
        executor: account,
        onesignal,
        redis: expect.any(Redis) as Redis,
      },
      load: () => import("../../hooks/bin/block"),
      name: "block",
      secrets: [
        "block-alchemy-webhooks-key",
        "block-alchemy-block-key",
        "block-postgres-url",
        "block-onesignal-api-key",
        "redis-url",
      ],
    },
    {
      accounts: [],
      config: { bridge, bridgeWebhookKey: "bridge-webhook-public-key", database, onesignal, persona, segment },
      load: () => import("../../hooks/bin/bridge"),
      name: "bridge",
      secrets: [
        "bridge-bridge-api-key",
        "bridge-api-url",
        "bridge-postgres-url",
        "bridge-onesignal-api-key",
        "bridge-persona-api-key",
        "persona-api-url",
        "bridge-segment-write-key",
        "bridge-webhook-public-key",
      ],
    },
    {
      accounts: [],
      config: { database, manteca, mantecaWebhookKey: "manteca-webhooks-key", onesignal, segment },
      load: () => import("../../hooks/bin/manteca"),
      name: "manteca",
      secrets: [
        "manteca-postgres-url",
        "manteca-manteca-api-key",
        "manteca-api-url",
        "manteca-webhooks-key",
        "manteca-onesignal-api-key",
        "manteca-segment-write-key",
      ],
    },
    {
      accounts: ["issuer", "settler"],
      config: {
        database,
        issuer,
        onesignal,
        panda,
        refund: queue,
        sardine,
        segment,
        settler: account,
        webhook: queue,
        webhookKey: "panda-webhooks-key",
      },
      load: () => import("../../hooks/bin/panda"),
      name: "panda",
      secrets: [
        "panda-postgres-url",
        "panda-onesignal-api-key",
        "panda-panda-api-key",
        "panda-api-url",
        "panda-webhooks-key",
        "redis-url",
        "panda-sardine-api-key",
        "sardine-api-url",
        "panda-segment-write-key",
      ],
    },
    {
      accounts: [],
      config: {
        allow: queue,
        database,
        panda,
        pax,
        persona,
        personaWebhookSecret: "persona-persona-webhook-secret",
        sardine,
      },
      load: () => import("../../hooks/bin/persona"),
      name: "persona",
      secrets: [
        "persona-postgres-url",
        "persona-panda-api-key",
        "panda-api-url",
        "persona-pax-associate-id-key",
        "persona-pax-api-key",
        "pax-api-url",
        "persona-persona-api-key",
        "persona-api-url",
        "persona-persona-webhook-secret",
        "redis-url",
        "persona-sardine-api-key",
        "sardine-api-url",
      ],
    },
    {
      accounts: [],
      config: {
        redis: expect.any(Redis) as Redis,
        whatsappFrom: "whatsapp",
        whatsappSecret: "chat-whatsapp-app-secret",
        whatsappVerifyToken: "chat-whatsapp-verify-token",
      },
      load: () => import("../../hooks/bin/chat"),
      name: "chat",
      secrets: ["redis-url", "chat-whatsapp-app-secret", "chat-whatsapp-verify-token"],
    },
    {
      accounts: [],
      config: { database, token: "sponsor-token" },
      load: () => import("../../hooks/bin/sponsor"),
      name: "sponsor",
      secrets: ["sponsor-postgres-url", "sponsor-token"],
    },
  ])(
    "resolves config before constructing and supervising the $name hook",
    async ({ accounts, config, load, name, secrets }) => {
      await load();
      const created = mocks.supervise.mock.calls[0]?.[1];
      if (!created) throw new Error(`missing ${name} hook`);
      const handle = await created;

      expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual(secrets);
      expect(new Set(mocks.secret.mock.calls.map(([, client]) => client)).size).toBe(1);
      expect(mocks.signer.mock.calls.map(([role]) => role)).toStrictEqual(accounts);
      const response = await handle.app.request("/");
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ status: "ok" });
      expect(mocks.hook).toHaveBeenCalledExactlyOnceWith(config);
      expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith(name, created);

      await handle.close();
      expect(database.$client.end).toHaveBeenCalledTimes("database" in config ? 1 : 0);
      expect(segment.close).toHaveBeenCalledTimes("segment" in config ? 1 : 0);
      const clients = Object.values(mocks.hook.mock.calls[0]?.[0] ?? {}).filter((value) => value instanceof Redis);
      const pings = await Promise.allSettled(clients.map((client) => client.ping()));
      expect(pings.map(({ status }) => status)).toStrictEqual(clients.map(() => "rejected"));
    },
  );

  it("releases the database and secrets when the sponsor hook closes", async () => {
    await import("../../hooks/bin/sponsor");
    const handle = await mocks.supervise.mock.calls[0]?.[1];
    if (!handle) throw new Error("missing sponsor hook");

    await handle.close();

    expect(database.$client.end).toHaveBeenCalledOnce();
    expect(mocks.closeSecrets).toHaveBeenCalledOnce();
  });

  it.each([
    { accounts: ["executor"], load: () => import("../../hooks/bin/block"), name: "block", role: "executor" },
    { accounts: ["issuer", "settler"], load: () => import("../../hooks/bin/panda"), name: "panda", role: "issuer" },
    { accounts: ["issuer", "settler"], load: () => import("../../hooks/bin/panda"), name: "panda", role: "settler" },
  ])("fails before constructing the $name hook without its $role account", async ({ accounts, load, name, role }) => {
    const error = new Error(`missing ${role}`);
    mocks.signer.mockImplementation((accountName) =>
      accountName === role ? Promise.reject(error) : Promise.resolve(accountName === "issuer" ? issuer : account),
    );
    mocks.supervise.mockImplementation((_, created) => {
      created.catch(() => undefined);
    });

    await load();
    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error(`missing ${name} hook`);

    await expect(created).rejects.toBe(error);
    expect(mocks.signer.mock.calls.map(([accountName]) => accountName)).toStrictEqual(accounts);
    expect(mocks.hook).not.toHaveBeenCalled();
  });
});

type Handle = {
  app: Hono;
  close(): Promise<unknown>;
  ready: Promise<unknown>;
};
