import { Hono } from "hono";
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
const credit = { close: vi.fn<() => Promise<void>>() };
const allow = { close: vi.fn<() => Promise<void>>() };
const poke = { close: vi.fn<() => Promise<void>>() };
const refund = { close: vi.fn<() => Promise<void>>() };
const webhook = { close: vi.fn<() => Promise<void>>() };
const mocks = {
  alchemy: vi.fn<(key: string) => object>(),
  allow: vi.fn<(bullmq: object) => typeof allow>(),
  bridge: vi.fn<(key: string, url: string) => object>(),
  credit: vi.fn<(bullmq: object) => typeof credit>(),
  drizzle: vi.fn<() => typeof database>(),
  hook: vi.fn<(config: Record<string, unknown>) => Handle>(),
  manteca: vi.fn<(key: string, url: string) => object>(),
  onesignal: vi.fn<(key: string) => object>(),
  panda: vi.fn<(config: { key: string; url: string }) => object>(),
  pax: vi.fn<(config: { associateKey: string; key: string; url: string }) => object>(),
  persona: vi.fn<(key: string, url: string) => object>(),
  poke: vi.fn<(bullmq: object) => typeof poke>(),
  refund: vi.fn<(bullmq: object) => typeof refund>(),
  sardine: vi.fn<(key: string, url: string) => object>(),
  secret: vi.fn<(name: string, secrets: object) => Promise<string>>(),
  segment: vi.fn<(key: string) => typeof segment>(),
  signer: vi.fn<(name: string, kms: object) => Promise<typeof account>>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
  webhook: vi.fn<(bullmq: object) => typeof webhook>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mocks.alchemy.mockReset().mockReturnValue(alchemy);
  mocks.allow.mockReset().mockReturnValue(allow);
  mocks.bridge.mockReset().mockReturnValue(bridge);
  mocks.credit.mockReset().mockReturnValue(credit);
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
  mocks.poke.mockReset().mockReturnValue(poke);
  mocks.refund.mockReset().mockReturnValue(refund);
  mocks.sardine.mockReset().mockReturnValue(sardine);
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
  mocks.segment.mockReset().mockReturnValue(segment);
  mocks.signer.mockReset().mockImplementation((name) => Promise.resolve(name === "issuer" ? issuer : account));
  mocks.supervise.mockReset();
  mocks.webhook.mockReset().mockReturnValue(webhook);
  vi.doMock("drizzle-orm/node-postgres", () => ({ drizzle: mocks.drizzle }));
  vi.doMock("ioredis", () => ({
    Redis: class {
      constructor(
        readonly redisUrl: string,
        readonly options?: { maxRetriesPerRequest: number },
      ) {}
    },
  }));
  vi.doMock("../../hooks/activity", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/block", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/bridge", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/chat", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/manteca", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/panda", () => ({ default: mocks.hook }));
  vi.doMock("../../hooks/persona", () => ({ default: mocks.hook }));
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
  vi.doMock("../../workers/credit/queue", () => ({ default: mocks.credit }));
  vi.doMock("../../workers/allow/queue", () => ({ default: mocks.allow }));
  vi.doMock("../../workers/hook/queue", () => ({ default: mocks.webhook }));
  vi.doMock("../../workers/poke/queue", () => ({ default: mocks.poke }));
  vi.doMock("../../workers/refund/queue", () => ({ default: mocks.refund }));
});

describe("hook bin", () => {
  it.each([
    {
      accounts: [],
      config: {
        alchemy,
        database,
        onesignal,
        poke,
        redis: expect.objectContaining({ redisUrl: "redis-url", options: undefined }) as object,
      },
      load: () => import("../../hooks/bin/activity"),
      name: "activity",
      secrets: ["activity-alchemy-webhooks-key", "activity-postgres-url", "activity-onesignal-api-key", "redis-url"],
    },
    {
      accounts: ["executor"],
      config: {
        alchemy,
        executor: account,
        onesignal,
        redis: expect.objectContaining({ redisUrl: "redis-url", options: undefined }) as object,
      },
      load: () => import("../../hooks/bin/block"),
      name: "block",
      secrets: ["block-alchemy-webhooks-key", "block-onesignal-api-key", "redis-url"],
    },
    {
      accounts: [],
      config: { bridge, database, onesignal, persona, segment },
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
        credit,
        database,
        issuer,
        onesignal,
        panda,
        persona,
        refund,
        sardine,
        segment,
        settler: account,
        webhook,
      },
      load: () => import("../../hooks/bin/panda"),
      name: "panda",
      secrets: [
        "panda-postgres-url",
        "panda-onesignal-api-key",
        "panda-panda-api-key",
        "panda-api-url",
        "panda-persona-api-key",
        "persona-api-url",
        "redis-url",
        "panda-sardine-api-key",
        "sardine-api-url",
        "panda-segment-write-key",
      ],
    },
    {
      accounts: [],
      config: {
        allow,
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
        redis: expect.objectContaining({ redisUrl: "redis-url", options: { maxRetriesPerRequest: 1 } }) as object,
        whatsappFrom: "whatsapp",
        whatsappSecret: "chat-whatsapp-app-secret",
        whatsappVerifyToken: "chat-whatsapp-verify-token",
      },
      load: () => import("../../hooks/bin/chat"),
      name: "chat",
      secrets: ["redis-url", "chat-whatsapp-app-secret", "chat-whatsapp-verify-token"],
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
    },
  );

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
