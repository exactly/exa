import "../mocks/sentry";

import { parse, ValiError } from "valibot";
import { padHex } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usdcAddress } from "@exactly/common/generated/chain";
import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { Address } from "@exactly/common/validation";

import createPanda from "../../utils/panda";
import * as Panda from "../../utils/panda";
import ServiceError from "../../utils/ServiceError";

const chainMock = vi.hoisted(() => ({ id: 0, testnet: true as boolean | undefined }));

vi.mock("@exactly/common/generated/chain", async (importOriginal) => ({
  ...(await importOriginal()),
  default: Object.assign(chainMock, baseSepolia, {
    rpcUrls: { ...baseSepolia.rpcUrls, alchemy: baseSepolia.rpcUrls.default },
  }),
}));

const panda = { ...Panda, ...createPanda({ key: "panda", url: "https://panda.test" }) };

describe("decline reasons", () => {
  it.each([
    ["frozen card", "frozen card"],
    ["bad collection", "transaction declined"],
    ["unexpected error", "transaction declined"],
  ])("maps %s to %s", (reason, message) => {
    expect(Panda.declineMessage(reason)).toStrictEqual(message);
  });
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

  it("gets a company user without a phone", async () => {
    const user = {
      id: "user-id",
      firstName: "Jhon",
      lastName: "Doe",
      email: "jhon@example.com",
      isActive: true,
      applicationStatus: "approved",
      applicationReason: "",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(user));

    await expect(panda.getUser("user-id")).resolves.toStrictEqual(user);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/users/user-id"),
      expect.objectContaining({ method: "GET" }),
    );
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

  it("lists tenant contracts", async () => {
    const contract = {
      chainId: baseSepolia.id,
      contractVersion: 1,
      controllerAddress: parse(Address, padHex("0xc0", { size: 20 })),
      proxyAddress: parse(Address, padHex("0xb0", { size: 20 })),
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json([
          { ...contract, id: "contract", depositAddress: contract.proxyAddress, adminAddresses: [], tokens: [] },
        ]),
      );

    await expect(panda.getContracts()).resolves.toStrictEqual([contract]);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/tenants/contracts"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("lists company users through the parent tenant", async () => {
    const users = [{ id: "user-id", walletAddress: "0x1234" }];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(users));

    await expect(panda.getCompanyUsers("company-id")).resolves.toStrictEqual(users);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/users?companyId=company-id"),
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("business application", () => {
  const account = parse(Address, padHex("0xb0b", { size: 20 }));
  const address = {
    line1: "1 Main St",
    city: "New York",
    region: "NY",
    postalCode: "10001",
    countryCode: "US",
  };
  const owner = {
    firstName: "Jane",
    lastName: "Doe",
    birthDate: "1990-01-01",
    nationalId: "123456789",
    countryOfIssue: "US",
    email: "jane@example.com",
    address,
  };
  const company = {
    name: "Account Acme",
    address,
    entity: {
      name: "Account Acme",
      description: "Account software",
      industry: "541511",
      registrationNumber: "123",
      taxId: "456",
      website: "https://example.com",
    },
    initialUser: { ...owner, ipAddress: "127.0.0.1", walletAddress: account },
    representatives: [owner],
    ultimateBeneficialOwners: [owner],
  } satisfies Parameters<typeof panda.createCompanyApplication>[1];

  afterEach(() => vi.restoreAllMocks());

  it("creates a company application", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: "company-1", name: "Account Acme", address }));

    await expect(panda.createCompanyApplication("reference-id", company)).resolves.toStrictEqual({
      id: "company-1",
      name: "Account Acme",
      address,
    });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/applications/company"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Idempotency-Key": "business-application:reference-id" }) as unknown,
      }),
    );
    expect(JSON.parse(fetchSpy.mock.lastCall?.[1]?.body as string)).toStrictEqual({
      ...company,
      sourceKey: "EXA",
      externalId: "reference-id",
    });
  });

  it("rejects semantic company-field validation failures", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      panda.createCompanyApplication("reference-id", {
        ...company,
        entity: { ...company.entity, website: "not a url" },
      }),
    ).rejects.toThrow(ValiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preserves the verification link signature", async () => {
    const externalId = "0x7fE85c89A8406B6Fc911f064e344fac2DFfD1C1b";
    const signature = "x".repeat(156);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        id: "company-1",
        externalId,
        applicationStatus: "needsVerification",
        applicationExternalVerificationLink: {
          url: "https://cardmemberportal.com/kyc",
          params: { userId: "0e3c467c-01e3-4fe8-8778-1c88e02fd000", signature },
        },
      }),
    );
    const application = await panda.getCompanyApplication(externalId);

    expect(application?.applicationExternalVerificationLink).toStrictEqual({
      url: "https://cardmemberportal.com/kyc",
      params: { userId: "0e3c467c-01e3-4fe8-8778-1c88e02fd000", signature },
    });
  });

  it("returns nothing when the company application does not exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await expect(panda.getCompanyApplication("0x269E1Eb82cc3c3Ee64b47cDA34acAED8203aF066")).resolves.toBeUndefined();
  });

  it("rethrows non-404 company application errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("server error", { status: 500 }));
    await expect(panda.getCompanyApplication("0xbeef")).rejects.toMatchObject({ status: 500 });
  });

  it("rejects a company application for another reference id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ id: "company-1", externalId: "0xdead", applicationStatus: "pending" }),
    );

    await expect(panda.getCompanyApplication("0xbeef")).rejects.toThrow("panda company external id mismatch");
  });

  it("accepts a company application without a reference id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ id: "company-1", applicationStatus: "pending" }),
    );

    await expect(panda.getCompanyApplication("0xbeef")).resolves.toMatchObject({ id: "company-1" });
  });

  it("accepts a not started company application", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ id: "company-1", applicationStatus: "notStarted" }),
    );

    await expect(panda.getCompanyApplication("0xbeef")).resolves.toMatchObject({
      id: "company-1",
      applicationStatus: "notStarted",
    });
  });
});

describe("withdrawals", () => {
  const account = parse(Address, padHex("0xb0b", { size: 20 }));

  it("requests testnet withdrawals", async () => {
    chainMock.id = baseSepolia.id;
    chainMock.testnet = true;
    const parameters = [account, account, "100", account, 1, [1, 2], "0x1234"];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ parameters }));

    await expect(panda.getWithdrawal(100, account, account)).resolves.toStrictEqual({ parameters });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `/issuing/tenants/signatures/withdrawals?token=0x29684075a3C86ea11D9964BcAf0F956e801396bD&amount=100&recipientAddress=${account}&adminAddress=${account}&chainId=${baseSepolia.id}`,
      ),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("requests mainnet withdrawals", async () => {
    chainMock.id = base.id;
    chainMock.testnet = false;
    const parameters = [account, account, "100", account, 1, [1, 2], "0x1234"];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ parameters }));

    await expect(panda.getWithdrawal(100, account, account)).resolves.toStrictEqual({ parameters });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `/issuing/tenants/signatures/withdrawals?token=${parse(Address, usdcAddress)}&amount=100`,
      ),
      expect.objectContaining({ method: "GET" }),
    );
    chainMock.testnet = true;
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
