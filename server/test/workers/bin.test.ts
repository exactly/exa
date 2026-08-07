import { padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const account = privateKeyToAccount(padHex("0x69"));
const mocks = {
  allow: vi.fn<(config: { allower: typeof account; redisUrl: string }) => Handle>(),
  close: vi.fn<() => Promise<void>>(),
  credit: vi.fn<(config: { onesignalKey: string; postgresUrl: string; redisUrl: string }) => Handle>(),
  poke: vi.fn<
    (config: { onesignalKey: string; poker: typeof account; redisUrl: string; segmentKey: string }) => Handle
  >(),
  refund:
    vi.fn<(config: { pandaKey: string; pandaUrl: string; redisUrl: string; refunder: typeof account }) => Handle>(),
  secret: vi.fn<(name: string) => Promise<string>>(),
  signer: vi.fn<(name: string) => Promise<typeof account>>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
  subscribe: vi.fn<(config: { alchemyKey: string; redisUrl: string }) => Handle>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bin", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.allow.mockReset();
    mocks.close.mockReset().mockResolvedValue();
    mocks.credit.mockReset();
    mocks.poke.mockReset();
    mocks.refund.mockReset();
    mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
    mocks.signer.mockReset().mockResolvedValue(account);
    mocks.supervise.mockReset();
    mocks.subscribe.mockReset();
    for (const worker of [mocks.allow, mocks.credit, mocks.poke, mocks.refund, mocks.subscribe]) {
      worker.mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
    }
    vi.doMock("../../supervise", () => ({ default: mocks.supervise }));
    vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
    vi.doMock("../../utils/wallet", () => ({ signer: mocks.signer }));
    vi.doMock("../../workers/allow/worker", () => ({ default: mocks.allow }));
    vi.doMock("../../workers/credit/worker", () => ({ default: mocks.credit }));
    vi.doMock("../../workers/poke/worker", () => ({ default: mocks.poke }));
    vi.doMock("../../workers/refund/worker", () => ({ default: mocks.refund }));
    vi.doMock("../../workers/subscribe/worker", () => ({ default: mocks.subscribe }));
  });

  it.each([
    {
      accounts: ["allower"],
      config: { allower: account, redisUrl: "redis-url" },
      load: () => import("../../workers/allow/bin"),
      name: "allow",
      secrets: ["redis-url"],
      worker: mocks.allow,
    },
    {
      accounts: [],
      config: {
        onesignalKey: "credit-onesignal-api-key",
        postgresUrl: "credit-postgres-url",
        redisUrl: "redis-url",
      },
      load: () => import("../../workers/credit/bin"),
      name: "credit",
      secrets: ["credit-onesignal-api-key", "credit-postgres-url", "redis-url"],
      worker: mocks.credit,
    },
    {
      accounts: ["poker"],
      config: {
        onesignalKey: "poke-onesignal-api-key",
        poker: account,
        redisUrl: "redis-url",
        segmentKey: "poke-segment-write-key",
      },
      load: () => import("../../workers/poke/bin"),
      name: "poke",
      secrets: ["poke-onesignal-api-key", "redis-url", "poke-segment-write-key"],
      worker: mocks.poke,
    },
    {
      accounts: ["refunder"],
      config: { pandaKey: "refund-panda-api-key", pandaUrl: "panda-api-url", redisUrl: "redis-url", refunder: account },
      load: () => import("../../workers/refund/bin"),
      name: "refund",
      secrets: ["refund-panda-api-key", "panda-api-url", "redis-url"],
      worker: mocks.refund,
    },
    {
      accounts: [],
      config: { alchemyKey: "subscribe-alchemy-webhooks-key", redisUrl: "redis-url" },
      load: () => import("../../workers/subscribe/bin"),
      name: "subscribe",
      secrets: ["subscribe-alchemy-webhooks-key", "redis-url"],
      worker: mocks.subscribe,
    },
  ])(
    "resolves $name private config before constructing and supervising its worker",
    async ({ accounts, config, load, name, secrets, worker }) => {
      await load();

      const created = mocks.supervise.mock.calls[0]?.[1];
      if (!created) throw new Error("missing worker");
      expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith(name, created);
      await created;
      expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual(secrets);
      expect(mocks.signer.mock.calls.map(([role]) => role)).toStrictEqual(accounts);
      expect(worker).toHaveBeenCalledExactlyOnceWith(config);
    },
  );

  it.each([
    { load: () => import("../../workers/allow/bin"), name: "allow", role: "allower", worker: mocks.allow },
    { load: () => import("../../workers/poke/bin"), name: "poke", role: "poker", worker: mocks.poke },
    { load: () => import("../../workers/refund/bin"), name: "refund", role: "refunder", worker: mocks.refund },
  ])("fails before constructing the $name worker without its $role account", async ({ load, name, role, worker }) => {
    const error = new Error(`missing ${role}`);
    mocks.signer.mockRejectedValueOnce(error);
    mocks.supervise.mockImplementation((_, created) => {
      created.catch(() => undefined);
    });

    await load();
    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error(`missing ${name} worker`);

    await expect(created).rejects.toBe(error);
    expect(mocks.signer).toHaveBeenCalledExactlyOnceWith(role);
    expect(worker).not.toHaveBeenCalled();
  });
});

type Handle = {
  close(): Promise<void>;
  ready: Promise<void>;
};
