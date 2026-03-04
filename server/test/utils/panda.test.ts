import "../mocks/sentry";

import { parse } from "valibot";
import { toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";
import { beforeEach, describe, expect, it, vi } from "vitest";

import chain from "@exactly/common/generated/chain";
import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { Address } from "@exactly/common/validation";

import * as keeperModule from "../../utils/keeper";
import * as panda from "../../utils/panda";
import ServiceError from "../../utils/ServiceError";

const chainMock = vi.hoisted(() => ({ id: 0 }));
const exaSend = vi.hoisted(() => vi.fn());
const testAccount = privateKeyToAccount(generatePrivateKey());

vi.mock("@exactly/common/generated/chain", async (importOriginal) => ({
  ...(await importOriginal()),
  default: Object.assign(chainMock, baseSepolia, {
    rpcUrls: { ...baseSepolia.rpcUrls, alchemy: baseSepolia.rpcUrls.default },
  }),
}));

vi.mock("../../utils/keeper", async (importOriginal) => {
  const original = await importOriginal<typeof keeperModule>();
  return {
    ...original,
    extender: vi.fn((): { exaSend: typeof exaSend } => ({ exaSend })),
    getAccount: vi.fn(),
  };
});

describe("panda request", () => {
  it("extracts entity from url on not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"message":"Not Found","error":"NotFoundError","statusCode":404}'),
    } as Response);

    const rejection = panda.getUser("some-id");
    await expect(rejection).rejects.toBeInstanceOf(ServiceError);
    await expect(rejection).rejects.toMatchObject({ name: "PandaNotFound", status: 404, message: "user" });
  });

  it("extracts card entity from url on not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"message":"Not Found","error":"NotFoundError","statusCode":404}'),
    } as Response);

    const rejection = panda.getCard("some-id");
    await expect(rejection).rejects.toBeInstanceOf(ServiceError);
    await expect(rejection).rejects.toMatchObject({ name: "PandaNotFound", status: 404, message: "card" });
  });

  it("lists a user's cards", async () => {
    const cards = [
      {
        id: "3c90c3cc-0d44-4b50-8888-8dd25736052a",
        status: "active",
        last4: "4242",
        expirationMonth: "9",
        expirationYear: "2029",
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(cards)).buffer),
    } as Response);

    await expect(panda.getCards("e5cd86bb-a19e-4a66-9728-9e6c5d97e616")).resolves.toStrictEqual(cards);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/cards?userId=e5cd86bb-a19e-4a66-9728-9e6c5d97e616&limit=100"),
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("create card", () => {
  const card = {
    id: "card-id",
    userId: "user-id",
    type: "virtual",
    status: "active",
    limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
    last4: "1234",
    expirationMonth: "12",
    expirationYear: "2030",
  };

  it("sends sandbox card art on base sepolia", async () => {
    chainMock.id = baseSepolia.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(card)).buffer),
    } as Response);

    await expect(panda.createCard("user-id", PLATINUM_PRODUCT_ID)).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: PLATINUM_PRODUCT_ID, virtualCardArt: "0c515d7eb0a140fa8f938f8242b0780a" },
        }),
      }),
    );
  });

  it("sends sandbox card art on optimism sepolia", async () => {
    chainMock.id = optimismSepolia.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(card)).buffer),
    } as Response);

    await expect(panda.createCard("user-id", SIGNATURE_PRODUCT_ID)).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: SIGNATURE_PRODUCT_ID, virtualCardArt: "0c515d7eb0a140fa8f938f8242b0780a" },
        }),
      }),
    );
  });

  it("sends platinum card art on optimism", async () => {
    chainMock.id = optimism.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(card)).buffer),
    } as Response);

    await expect(panda.createCard("user-id", PLATINUM_PRODUCT_ID)).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: PLATINUM_PRODUCT_ID, virtualCardArt: "81e42f27affd4e328f19651d4f2b438e" },
        }),
      }),
    );
  });

  it("sends signature card art on base", async () => {
    chainMock.id = base.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(card)).buffer),
    } as Response);

    await expect(panda.createCard("user-id", SIGNATURE_PRODUCT_ID)).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: SIGNATURE_PRODUCT_ID, virtualCardArt: "398c4919514b4ec4927e6a9114a4c816" },
        }),
      }),
    );
  });
});

describe("siwe", () => {
  it("returns the generated nonce", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode('{"nonce":"Db2ItfTPLuZ2dV0ZQ"}').buffer),
    } as Response);

    await expect(panda.getNonce("e5cd86bb-a19e-4a66-9728-9e6c5d97e616")).resolves.toStrictEqual({
      nonce: "Db2ItfTPLuZ2dV0ZQ",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/users/e5cd86bb-a19e-4a66-9728-9e6c5d97e616/signatures/generate-nonce"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("verify message", async () => {
    const payload = {
      authType: "siwe" as const,
      message: "I authorize the account 0xabc to be linked with the card ending in 1234 for my user (e5cd86bb).",
      signature: "0x57d2c1f0c01b9173e080bd3cdd40600924cc0c4c31dfe45353d9d967c35d16944a",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as Response);

    await expect(panda.verify("e5cd86bb-a19e-4a66-9728-9e6c5d97e616", payload)).resolves.toStrictEqual({});
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/users/e5cd86bb-a19e-4a66-9728-9e6c5d97e616/signatures/verify"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify(payload) }),
    );
  });
});

describe("mutex", () => {
  it("creates and retrieves mutex with string key", () => {
    const mutex = panda.createMutex("event-id");
    expect(panda.getMutex("event-id")).toBe(mutex);
  });

  it("creates and retrieves mutex with address key", () => {
    const address = "0x1234567890123456789012345678901234567890";
    const mutex = panda.createMutex(address as `0x${string}`);
    expect(panda.getMutex(address as `0x${string}`)).toBe(mutex);
  });

  it("returns undefined for unknown key", () => {
    expect(panda.getMutex("nonexistent")).toBeUndefined();
  });

  it("string and address keys are independent", () => {
    const stringMutex = panda.createMutex("some-key");
    const addressMutex = panda.createMutex("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as `0x${string}`);
    expect(stringMutex).not.toBe(addressMutex);
  });
});

describe("withdraw", () => {
  const recipient = parse(Address, testAccount.address);
  const signature = {
    parameters: [
      testAccount.address,
      testAccount.address,
      1_000_000,
      testAccount.address,
      1_700_000_000,
      [1, 2, 3],
      "0x1234",
    ],
  };
  const fetchSpy = vi.spyOn(globalThis, "fetch");

  beforeEach(() => {
    chainMock.id = baseSepolia.id;
    fetchSpy.mockReset();
    exaSend.mockClear().mockResolvedValue({});
    vi.mocked(keeperModule.getAccount).mockReset().mockResolvedValue(testAccount);
  });

  it("retries account init after a failed first attempt", async () => {
    vi.mocked(keeperModule.getAccount).mockRejectedValueOnce(new Error("kms down"));
    fetchSpy.mockResolvedValue(Response.json(signature));

    await expect(panda.withdraw(1_000_000n, recipient)).rejects.toThrow("kms down");
    expect(exaSend).not.toHaveBeenCalled();

    await panda.withdraw(1_000_000n, recipient);
    expect(vi.mocked(keeperModule.getAccount)).toHaveBeenCalledTimes(2);
    expect(exaSend).toHaveBeenCalledOnce();
  });

  it("fetches the signature in base units and submits withdrawAsset", async () => {
    fetchSpy.mockResolvedValue(Response.json(signature));

    await panda.withdraw(1_000_000n, recipient);

    const url = fetchSpy.mock.calls[0]?.[0];
    expect(url).toContain("/issuing/tenants/signatures/withdrawals");
    expect(url).toContain("amount=1000000");
    expect(url).toContain(`chainId=${chain.id}`);
    expect(url).toContain(`recipientAddress=${recipient}`);
    expect(exaSend).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "panda.withdraw", op: "panda.withdraw", attributes: { account: recipient } }),
      expect.objectContaining({
        functionName: "withdrawAsset",
        args: [
          testAccount.address,
          testAccount.address,
          1_000_000n,
          testAccount.address,
          1_700_000_000n,
          toHex(Buffer.from([1, 2, 3])),
          "0x1234",
        ],
      }),
    );
  });

  it("propagates signature fetch failure without submitting", async () => {
    fetchSpy.mockResolvedValue(new Response("server error", { status: 500 }));
    await expect(panda.withdraw(500_000n, recipient)).rejects.toBeInstanceOf(ServiceError);
    expect(exaSend).not.toHaveBeenCalled();
  });

  it("propagates malformed signature response without submitting", async () => {
    fetchSpy.mockResolvedValue(Response.json({ parameters: [] }));
    await expect(panda.withdraw(500_000n, recipient)).rejects.toThrow();
    expect(exaSend).not.toHaveBeenCalled();
  });
});
