import { padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Supervise from "../../supervise";

const alchemy = {};
const refunder = privateKeyToAccount(padHex("0xfee"));
const database = { $client: { end: vi.fn<() => Promise<void>>() } };
const onesignal = {};
const panda = {};
const sardine = {};
const segment = { close: vi.fn<() => Promise<void>>() };
const mocks = {
  alchemy: vi.fn<(key: string) => object>(),
  close: vi.fn<() => Promise<void>>(),
  drizzle: vi.fn<() => typeof database>(),
  hook: vi.fn<(config: { bullmq: object; database: typeof database; panda: object }) => Handle>(),
  onesignal: vi.fn<(key: string) => object>(),
  panda: vi.fn<(config: { key: string; url: string }) => object>(),
  refund:
    vi.fn<
      (config: {
        bullmq: object;
        database: typeof database;
        onesignal: object;
        panda: object;
        refunder: typeof refunder;
        sardine: object;
        segment: typeof segment;
      }) => Handle
    >(),
  secret: vi.fn<(name: string, secrets: object) => Promise<string>>(),
  segment: vi.fn<(key: string) => typeof segment>(),
  signer: vi.fn<(name: string) => Promise<typeof refunder>>(),
  sardine: vi.fn<(key: string, url: string) => object>(),
  subscribe: vi.fn<(config: { alchemy: object; bullmq: object }) => Handle>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mocks.alchemy.mockReset().mockReturnValue(alchemy);
  mocks.close.mockReset().mockResolvedValue();
  mocks.drizzle.mockReset().mockReturnValue(database);
  mocks.hook.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.onesignal.mockReset().mockReturnValue(onesignal);
  mocks.panda.mockReset().mockReturnValue(panda);
  mocks.refund.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.sardine.mockReset().mockReturnValue(sardine);
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
  mocks.segment.mockReset().mockReturnValue(segment);
  mocks.signer.mockReset().mockResolvedValue(refunder);
  mocks.subscribe.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.supervise.mockReset();
  vi.doMock("drizzle-orm/node-postgres", () => ({ drizzle: mocks.drizzle }));
  vi.doMock("ioredis", () => ({
    Redis: class {
      constructor(
        readonly redisUrl: string,
        readonly options: { maxRetriesPerRequest: null },
      ) {}
    },
  }));
  vi.doMock("../../supervise", async (importOriginal) => ({
    ...(await importOriginal<typeof Supervise>()),
    default: mocks.supervise,
  }));
  vi.doMock("../../utils/alchemy", () => ({ default: mocks.alchemy }));
  vi.doMock("../../utils/onesignal", () => ({ default: mocks.onesignal }));
  vi.doMock("../../utils/panda", () => ({ default: mocks.panda }));
  vi.doMock("../../utils/sardine", () => ({ default: mocks.sardine }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
  vi.doMock("../../utils/segment", () => ({ default: mocks.segment }));
  vi.doMock("../../utils/wallet", () => ({ signer: mocks.signer }));
  vi.doMock("../../workers/hook/worker", () => ({ default: mocks.hook }));
  vi.doMock("../../workers/refund/worker", () => ({ default: mocks.refund }));
  vi.doMock("../../workers/subscribe/worker", () => ({ default: mocks.subscribe }));
});

describe("bin", () => {
  it("resolves refund private config before constructing and supervising its worker", async () => {
    await import("../../workers/refund/bin");

    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");
    expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("refund", created);
    await created;
    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual([
      "redis-url",
      "refund-postgres-url",
      "refund-onesignal-api-key",
      "refund-panda-api-key",
      "panda-api-url",
      "refund-sardine-api-key",
      "sardine-api-url",
      "refund-segment-write-key",
    ]);
    expect(new Set(mocks.secret.mock.calls.map(([, secrets]) => secrets)).size).toBe(1);
    expect(mocks.signer.mock.calls.map(([signer]) => signer)).toStrictEqual(["refunder"]);
    expect(mocks.panda).toHaveBeenCalledExactlyOnceWith({ key: "refund-panda-api-key", url: "panda-api-url" });
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith({
      bullmq: expect.objectContaining({ redisUrl: "redis-url", options: { maxRetriesPerRequest: null } }) as object,
      database,
      onesignal,
      panda,
      refunder,
      sardine,
      segment,
    });
  });

  it("fails before constructing the refund worker without its refunder account", async () => {
    const error = new Error("missing refunder");
    mocks.signer.mockRejectedValue(error);
    mocks.supervise.mockImplementation((_, created) => {
      created.catch(() => undefined);
    });

    await import("../../workers/refund/bin");
    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");

    await expect(created).rejects.toBe(error);
    expect(mocks.refund).not.toHaveBeenCalled();
  });

  it("resolves hook private config before constructing and supervising its worker", async () => {
    await import("../../workers/hook/bin");

    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");
    expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("hook", created);
    await created;
    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual([
      "redis-url",
      "hook-postgres-url",
      "hook-panda-api-key",
      "panda-api-url",
    ]);
    expect(new Set(mocks.secret.mock.calls.map(([, secrets]) => secrets)).size).toBe(1);
    expect(mocks.panda).toHaveBeenCalledExactlyOnceWith({ key: "hook-panda-api-key", url: "panda-api-url" });
    expect(mocks.hook).toHaveBeenCalledExactlyOnceWith({
      bullmq: expect.objectContaining({ redisUrl: "redis-url", options: { maxRetriesPerRequest: null } }) as object,
      database,
      panda,
    });
  });

  it("fails before constructing the hook worker without its secrets", async () => {
    const error = new Error("missing secret");
    mocks.secret.mockRejectedValue(error);
    mocks.supervise.mockImplementation((_, created) => {
      created.catch(() => undefined);
    });

    await import("../../workers/hook/bin");
    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");

    await expect(created).rejects.toBe(error);
    expect(mocks.hook).not.toHaveBeenCalled();
  });

  it("resolves subscribe private config before constructing and supervising its worker", async () => {
    await import("../../workers/subscribe/bin");

    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");
    expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("subscribe", created);
    await created;
    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual([
      "subscribe-alchemy-webhooks-key",
      "redis-url",
    ]);
    expect(new Set(mocks.secret.mock.calls.map(([, secrets]) => secrets)).size).toBe(1);
    expect(mocks.alchemy).toHaveBeenCalledExactlyOnceWith("subscribe-alchemy-webhooks-key");
    expect(mocks.subscribe).toHaveBeenCalledExactlyOnceWith({
      alchemy,
      bullmq: expect.objectContaining({ redisUrl: "redis-url", options: { maxRetriesPerRequest: null } }) as object,
    });
  });
});

type Handle = {
  close(): Promise<void>;
  ready: Promise<void>;
};
