import "../mocks/sentry";

import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";

import * as panda from "../../utils/panda";
import ServiceError from "../../utils/ServiceError";

const chainMock = vi.hoisted(() => ({ id: 0 }));

vi.mock("@exactly/common/generated/chain", async (importOriginal) => ({
  ...(await importOriginal()),
  default: Object.assign(chainMock, baseSepolia, {
    rpcUrls: { ...baseSepolia.rpcUrls, alchemy: baseSepolia.rpcUrls.default },
  }),
}));

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
