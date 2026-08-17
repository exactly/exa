import { padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signers = {
  allower: privateKeyToAccount(padHex("0xa11")),
  executor: privateKeyToAccount(padHex("0xeec")),
  issuer: privateKeyToAccount(padHex("0x420")),
  poker: privateKeyToAccount(padHex("0xb0b")),
  refunder: privateKeyToAccount(padHex("0xfee")),
};
const mocks = {
  allow: vi.fn<(config: { allower: typeof signers.allower; redisUrl: string }) => Handle>(),
  close: vi.fn<() => Promise<void>>(),
  credit: vi.fn<(config: { onesignalKey: string; postgresUrl: string; redisUrl: string }) => Handle>(),
  poke: vi.fn<
    (config: { onesignalKey: string; poker: typeof signers.poker; redisUrl: string; segmentKey: string }) => Handle
  >(),
  execute: vi.fn<(config: { executor: typeof signers.executor; onesignalKey: string; redisUrl: string }) => Handle>(),
  refund:
    vi.fn<
      (config: {
        issuer: typeof signers.issuer;
        pandaKey: string;
        pandaUrl: string;
        redisUrl: string;
        refunder: typeof signers.refunder;
      }) => Handle
    >(),
  secret: vi.fn<(name: string) => Promise<string>>(),
  signer: vi.fn<(name: keyof typeof signers) => Promise<typeof signers.refunder>>(),
  subscribe: vi.fn<(config: { alchemyKey: string; redisUrl: string }) => Handle>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mocks.allow.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.close.mockReset().mockResolvedValue();
  mocks.credit.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.poke.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.execute.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.refund.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
  mocks.signer.mockReset().mockImplementation((name) => Promise.resolve(signers[name]));
  mocks.subscribe.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.supervise.mockReset();
  vi.doMock("../../supervise", () => ({ default: mocks.supervise }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
  vi.doMock("../../utils/wallet", () => ({ signer: mocks.signer }));
  vi.doMock("../../workers/allow/worker", () => ({ default: mocks.allow }));
  vi.doMock("../../workers/credit/worker", () => ({ default: mocks.credit }));
  vi.doMock("../../workers/poke/worker", () => ({ default: mocks.poke }));
  vi.doMock("../../workers/execute/worker", () => ({ default: mocks.execute }));
  vi.doMock("../../workers/refund/worker", () => ({ default: mocks.refund }));
  vi.doMock("../../workers/subscribe/worker", () => ({ default: mocks.subscribe }));
});

describe("bin", () => {
  it("resolves allow private config before constructing and supervising its worker", async () => {
    await import("../../workers/allow/bin");

    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");
    expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("allow", created);
    await created;
    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual(["redis-url"]);
    expect(mocks.signer.mock.calls.map(([signer]) => signer)).toStrictEqual(["allower"]);
    expect(mocks.allow).toHaveBeenCalledExactlyOnceWith({ allower: signers.allower, redisUrl: "redis-url" });
  });

  it("fails before constructing the allow worker without its allower account", async () => {
    const error = new Error("missing allower");
    mocks.signer.mockRejectedValueOnce(error);
    mocks.supervise.mockImplementation((_, created) => {
      created.catch(() => undefined);
    });

    await import("../../workers/allow/bin");
    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");

    await expect(created).rejects.toBe(error);
    expect(mocks.signer.mock.calls.map(([signer]) => signer)).toStrictEqual(["allower"]);
    expect(mocks.allow).not.toHaveBeenCalled();
  });

  it("resolves credit private config before constructing and supervising its worker", async () => {
    await import("../../workers/credit/bin");

    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");
    expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("credit", created);
    await created;
    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual([
      "credit-onesignal-api-key",
      "credit-postgres-url",
      "redis-url",
    ]);
    expect(mocks.credit).toHaveBeenCalledExactlyOnceWith({
      onesignalKey: "credit-onesignal-api-key",
      postgresUrl: "credit-postgres-url",
      redisUrl: "redis-url",
    });
  });

  it("resolves poke private config before constructing and supervising its worker", async () => {
    await import("../../workers/poke/bin");

    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");
    expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("poke", created);
    await created;
    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual([
      "poke-onesignal-api-key",
      "redis-url",
      "poke-segment-write-key",
    ]);
    expect(mocks.signer.mock.calls.map(([signer]) => signer)).toStrictEqual(["poker"]);
    expect(mocks.poke).toHaveBeenCalledExactlyOnceWith({
      onesignalKey: "poke-onesignal-api-key",
      poker: signers.poker,
      redisUrl: "redis-url",
      segmentKey: "poke-segment-write-key",
    });
  });

  it("fails before constructing the poke worker without its poker account", async () => {
    const error = new Error("missing poker");
    mocks.signer.mockRejectedValueOnce(error);
    mocks.supervise.mockImplementation((_, created) => {
      created.catch(() => undefined);
    });

    await import("../../workers/poke/bin");
    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");

    await expect(created).rejects.toBe(error);
    expect(mocks.signer.mock.calls.map(([signer]) => signer)).toStrictEqual(["poker"]);
    expect(mocks.poke).not.toHaveBeenCalled();
  });

  it("resolves execute private config before constructing and supervising its worker", async () => {
    await import("../../workers/execute/bin");

    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");
    expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("execute", created);
    await created;
    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual(["execute-onesignal-api-key", "redis-url"]);
    expect(mocks.signer.mock.calls.map(([signer]) => signer)).toStrictEqual(["executor"]);
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith({
      executor: signers.executor,
      onesignalKey: "execute-onesignal-api-key",
      redisUrl: "redis-url",
    });
  });

  it("fails before constructing the execute worker without its executor account", async () => {
    const error = new Error("missing executor");
    mocks.signer.mockRejectedValueOnce(error);
    mocks.supervise.mockImplementation((_, created) => {
      created.catch(() => undefined);
    });

    await import("../../workers/execute/bin");
    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");

    await expect(created).rejects.toBe(error);
    expect(mocks.signer.mock.calls.map(([signer]) => signer)).toStrictEqual(["executor"]);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("resolves refund private config before constructing and supervising its worker", async () => {
    await import("../../workers/refund/bin");

    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing worker");
    expect(mocks.supervise).toHaveBeenCalledExactlyOnceWith("refund", created);
    await created;
    expect(mocks.secret.mock.calls.map(([secret]) => secret)).toStrictEqual([
      "refund-panda-api-key",
      "panda-api-url",
      "redis-url",
    ]);
    expect(mocks.signer.mock.calls.map(([signer]) => signer)).toStrictEqual(["issuer", "refunder"]);
    expect(mocks.refund).toHaveBeenCalledExactlyOnceWith({
      issuer: signers.issuer,
      pandaKey: "refund-panda-api-key",
      pandaUrl: "panda-api-url",
      redisUrl: "redis-url",
      refunder: signers.refunder,
    });
  });

  it.each(["refunder", "issuer"] as const)(
    "fails before constructing the refund worker without its %s account",
    async (missing) => {
      const error = new Error(`missing ${missing}`);
      mocks.signer.mockImplementation((name) =>
        name === missing ? Promise.reject(error) : Promise.resolve(signers[name]),
      );
      mocks.supervise.mockImplementation((_, created) => {
        created.catch(() => undefined);
      });

      await import("../../workers/refund/bin");
      const created = mocks.supervise.mock.calls[0]?.[1];
      if (!created) throw new Error("missing worker");

      await expect(created).rejects.toBe(error);
      expect(mocks.signer.mock.calls.map(([signer]) => signer)).toStrictEqual(["issuer", "refunder"]);
      expect(mocks.refund).not.toHaveBeenCalled();
    },
  );

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
    expect(mocks.subscribe).toHaveBeenCalledExactlyOnceWith({
      alchemyKey: "subscribe-alchemy-webhooks-key",
      redisUrl: "redis-url",
    });
  });
});

type Handle = {
  close(): Promise<void>;
  ready: Promise<void>;
};
