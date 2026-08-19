import { padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signers = {
  issuer: privateKeyToAccount(padHex("0x420")),
  refunder: privateKeyToAccount(padHex("0xfee")),
};
const mocks = {
  close: vi.fn<() => Promise<void>>(),
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
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mocks.close.mockReset().mockResolvedValue();
  mocks.refund.mockReset().mockReturnValue({ close: mocks.close, ready: Promise.resolve() });
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
  mocks.signer.mockReset().mockImplementation((name) => Promise.resolve(signers[name]));
  mocks.supervise.mockReset();
  vi.doMock("../../supervise", () => ({ default: mocks.supervise }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
  vi.doMock("../../utils/wallet", () => ({ signer: mocks.signer }));
  vi.doMock("../../workers/refund/worker", () => ({ default: mocks.refund }));
});

describe("bin", () => {
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
});

type Handle = {
  close(): Promise<void>;
  ready: Promise<void>;
};
