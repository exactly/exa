import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { parse, ValiError } from "valibot";
import { padHex } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CLASSIC_PRODUCT_ID,
  PHYSICAL_SIGNATURE_PRODUCT_ID,
  PLATINUM_PRODUCT_ID,
  SIGNATURE_PRODUCT_ID,
} from "@exactly/common/panda";
import { Address } from "@exactly/common/validation";

import createPanda from "../../utils/panda";
import * as Panda from "../../utils/panda";
import ServiceError from "../../utils/ServiceError";

import type * as viem from "viem";

const chainMock = vi.hoisted(() => ({ id: 0, isBase: false, testnet: true as boolean | undefined }));

vi.mock("@exactly/common/generated/chain", async (importOriginal) => ({
  ...(await importOriginal()),
  default: Object.assign(chainMock, baseSepolia, {
    rpcUrls: { ...baseSepolia.rpcUrls, alchemy: baseSepolia.rpcUrls.default },
  }),
  get isBase() {
    return chainMock.isBase;
  },
}));

vi.mock("viem", async (importOriginal) => {
  const original = await importOriginal<typeof viem>();
  return {
    ...original,
    withRetry: (
      callback: Parameters<typeof original.withRetry>[0],
      options: Parameters<typeof original.withRetry>[1],
    ) => original.withRetry(callback, { ...options, delay: 1 }),
  };
});

const panda = { ...Panda, ...createPanda({ key: "panda", url: "https://panda.test" }) };

describe("programs", () => {
  afterEach(() => {
    chainMock.isBase = false;
  });

  it("serves only the home program without a base config", () => {
    const client = createPanda({ key: "panda", url: "https://panda.test" });

    expect(client.tenants()).toStrictEqual(["OP"]);
    expect(client.program("OP")).toBe(client);
    expect(() => client.program("BASE")).toThrow("no BASE program");
    expect(client.issuing(Panda.partner)).toBe("OP");
  });

  it("routes base cards to the base program", async () => {
    const client = createPanda(
      { key: "panda", url: "https://panda.test" },
      { key: "base", url: "https://base.panda.test" },
    );
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ nonce: "base" }));

    expect(client.tenants()).toStrictEqual(["OP", "BASE"]);
    expect(client.program("OP")).toBe(client);
    expect(client.program("BASE")).not.toBe(client);
    await expect(client.program("BASE").getNonce("user")).resolves.toStrictEqual({ nonce: "base" });
    expect(fetch).toHaveBeenCalledOnce();
    const [request, init] = fetch.mock.calls[0] ?? [];
    expect(request).toBe("https://base.panda.test/issuing/users/user/signatures/generate-nonce");
    expect(new Headers(init?.headers).get("api-key")).toBe("base");
  });

  it("issues partner cards on the base program", () => {
    const client = createPanda(
      { key: "panda", url: "https://panda.test" },
      { key: "base", url: "https://base.panda.test" },
    );

    expect(client.issuing(Panda.partner)).toBe("BASE");
    expect(client.issuing("other")).toBe("OP");
    expect(client.issuing(null)).toBe("OP");
  });

  it("ignores the base config on base stacks", () => {
    chainMock.isBase = true;
    const client = createPanda(
      { key: "panda", url: "https://panda.test" },
      { key: "base", url: "https://base.panda.test" },
    );

    expect(client.tenants()).toStrictEqual(["BASE"]);
    expect(client.program("BASE")).toBe(client);
    expect(() => client.program("OP")).toThrow("no OP program");
    expect(client.issuing(Panda.partner)).toBe("BASE");
    expect(client.issuing(null)).toBe("BASE");
    expect(Panda.home()).toBe("BASE");
    expect(Panda.other()).toBe("OP");
    expect(Panda.pandaUser({ pandaId: "home", otherPandaId: "other" }, "BASE")).toBe("home");
  });

  it("picks the user id of each program", () => {
    expect(Panda.home()).toBe("OP");
    expect(Panda.other()).toBe("BASE");
    expect(Panda.pandaUser({ pandaId: "home", otherPandaId: "other" }, "OP")).toBe("home");
    expect(Panda.pandaUser({ pandaId: "home", otherPandaId: "other" }, "BASE")).toBe("other");
  });
});

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
  afterEach(() => vi.clearAllMocks());

  it("extracts entity from url on not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"message":"Not Found","error":"NotFoundError","statusCode":404}', { status: 404 }),
    );

    const rejection = panda.getUser("some-id");
    await expect(rejection).rejects.toBeInstanceOf(ServiceError);
    await expect(rejection).rejects.toMatchObject({ name: "PandaNotFound", status: 404, message: "user" });
  });

  it("classifies generic not found as not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"statusCode":404,"error":"Not Found","message":"Not Found"}', { status: 404 }),
    );

    const rejection = panda.getUser("some-id");
    await expect(rejection).rejects.toBeInstanceOf(ServiceError);
    await expect(rejection).rejects.toMatchObject({ name: "PandaNotFound", status: 404, message: "user" });
  });

  it("keeps typed non-404 classification", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"statusCode":400,"error":"Not Found","message":"invalid"}', { status: 400 }),
    );

    await expect(panda.getUser("some-id")).rejects.toMatchObject({
      name: "PandaNotFound",
      status: 400,
      message: "invalid",
    });
  });

  it("keeps the status in plain-text errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await expect(panda.getUser("some-id")).rejects.toMatchObject({
      name: "PandaNotFound",
      status: 404,
      message: "404 Not Found",
    });
  });

  it("gets a company user without a phone", async () => {
    const user = {
      id: "user-id",
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
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
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"message":"Not Found","error":"NotFoundError","statusCode":404}', { status: 404 }),
    );

    const rejection = panda.getCard("some-id");
    await expect(rejection).rejects.toBeInstanceOf(ServiceError);
    await expect(rejection).rejects.toMatchObject({ name: "PandaNotFound", status: 404, message: "card" });
  });

  it("lists a user's cards", async () => {
    const cards = [
      {
        id: "3c90c3cc-0d44-4b50-8888-8dd25736052a",
        type: "virtual",
        status: "active",
        last4: "4242",
        expirationMonth: "9",
        expirationYear: "2029",
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(cards));

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
    const users = [{ id: "user-id", email: "user@example.com", walletAddress: "0x1234" }];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(users));

    await expect(panda.getCompanyUsers("company-id")).resolves.toStrictEqual(users);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://panda.test/issuing/users?companyId=company-id",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("filters company users by email", async () => {
    const users = [{ id: "user-id", email: "user+card@example.com" }];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(users));

    await expect(panda.getCompanyUsers("company-id", { email: "user+card@example.com" })).resolves.toStrictEqual(users);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://panda.test/issuing/users?companyId=company-id&email=user%2Bcard%40example.com",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("retries a read on an upstream 5xx", async () => {
    const cards = [
      {
        id: "3c90c3cc-0d44-4b50-8888-8dd25736052a",
        status: "active",
        last4: "4242",
        expirationMonth: "9",
        expirationYear: "2029",
        type: "virtual",
      },
    ];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("<html><title>Error 502 (Bad Gateway)!</title></html>", { status: 502 }))
      .mockResolvedValueOnce(Response.json(cards));

    await expect(panda.getCards("user-id")).resolves.toStrictEqual(cards);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[1]?.signal).toBe(fetchSpy.mock.calls[0]?.[1]?.signal);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "Panda502", status: 502 }),
      { level: "warning", fingerprint: ["{{ default }}", "panda.retry"] },
    );
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://panda.test/issuing/cards?userId=user-id&limit=100",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws the last upstream 5xx when every read fails", async () => {
    const html = "<html><title>Error 502 (Bad Gateway)!</title></html>";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 502 }))
      .mockResolvedValueOnce(new Response(html, { status: 502 }))
      .mockResolvedValueOnce(new Response(html, { status: 502 }));

    const rejection = panda.getUser("user-id");
    await expect(rejection).rejects.toBeInstanceOf(ServiceError);
    await expect(rejection).rejects.toMatchObject({ name: "Panda502", status: 502 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(captureException).toHaveBeenCalledTimes(2);
    expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ name: "Panda502", status: 502 }), {
      level: "warning",
      fingerprint: ["{{ default }}", "panda.retry"],
    });
  });

  it("does not retry a write on an upstream 5xx", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    await expect(panda.setPIN("card-id", "session-id", { data: "data", iv: "iv" })).rejects.toMatchObject({
      name: "Panda503",
      status: 503,
    });
    expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
      "https://panda.test/issuing/cards/card-id/pin",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not retry a read on a client error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await expect(panda.getUser("user-id")).rejects.toMatchObject({ name: "PandaNotFound", status: 404 });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not retry a read with an invalid response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ id: 1 }));

    await expect(panda.getUser("user-id")).rejects.toThrow(ValiError);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(captureException).not.toHaveBeenCalled();
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
      expect.objectContaining({ method: "POST" }),
    );
    expect(new Headers(fetchSpy.mock.lastCall?.[1]?.headers).get("Idempotency-Key")).toBe(
      "business-application:reference-id",
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

  it("creates a company user", async () => {
    const user = { email: "authorized@example.com", firstName: "Authorized", lastName: "User", walletAddress: account };
    const created = {
      ...user,
      id: "0e3c467c-01e3-4fe8-8778-1c88e02fd000",
      companyId: "4bd36e16-f65f-4b69-b227-68fa07f78c64",
      isActive: true,
      applicationStatus: "approved" as const,
      createdAt: "2026-11-03T19:07:35.000Z",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(created));

    await expect(panda.createCompanyUser("company-1", user, "evt-1")).resolves.toStrictEqual(created);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/companies/company-1/users"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(new Headers(fetchSpy.mock.lastCall?.[1]?.headers).get("Idempotency-Key")).toBe("company-user:evt-1");
    expect(JSON.parse(fetchSpy.mock.lastCall?.[1]?.body as string)).toStrictEqual(user);
  });

  it("rejects an invalid company user", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      panda.createCompanyUser(
        "company-1",
        { email: "not an email", firstName: "Authorized", lastName: "User" },
        "evt-1",
      ),
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
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response("server error", { status: 500 })));
    await expect(panda.getCompanyApplication("0xbeef")).rejects.toMatchObject({ status: 500 });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
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

  it("requests withdrawals on the given network", async () => {
    chainMock.id = optimism.id;
    chainMock.testnet = false;
    const token = parse(Address, padHex("0x70c", { size: 20 }));
    const parameters = [account, token, "100", account, 1, [1, 2], "0x1234"];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ parameters }));

    await expect(panda.getWithdrawal(100, account, account, base.id, token)).resolves.toStrictEqual({ parameters });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `/issuing/tenants/signatures/withdrawals?token=${token}&amount=100&recipientAddress=${account}&adminAddress=${account}&chainId=${base.id}`,
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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(card));

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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(card));

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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(card));

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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(card));

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
    expect(fetchSpy.mock.lastCall?.[1]?.headers).not.toHaveProperty("Idempotency-Key");
  });

  it("sends classic card art on base", async () => {
    chainMock.id = base.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(card));

    await expect(panda.createCard("user-id", CLASSIC_PRODUCT_ID)).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: CLASSIC_PRODUCT_ID, virtualCardArt: "1f3e23aaeb024388a0373c59ff3a5a7e" },
        }),
      }),
    );
  });

  it("sends the idempotency key", async () => {
    chainMock.id = base.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(card));

    await expect(panda.createCard("user-id", SIGNATURE_PRODUCT_ID, 200_000, "evt_123")).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 200_000, frequency: "per7DayPeriod" },
          configuration: { productId: SIGNATURE_PRODUCT_ID, virtualCardArt: "398c4919514b4ec4927e6a9114a4c816" },
        }),
      }),
    );
    expect(new Headers(fetchSpy.mock.lastCall?.[1]?.headers).get("Idempotency-Key")).toBe("card:evt_123");
  });

  it.each([
    [base.id, "c4c03256d6764a8390f41b60561d27af"],
    [optimism.id, "398c4919514b4ec4927e6a9114a4c816"],
  ] as const)("sends partner card art only on base (chain %i)", async (id, art) => {
    chainMock.id = id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(card));

    await expect(
      panda.createCard("user-id", SIGNATURE_PRODUCT_ID, 1_000_000, undefined, Panda.partner),
    ).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: SIGNATURE_PRODUCT_ID, virtualCardArt: art },
        }),
      }),
    );
    expect(new Headers(fetchSpy.mock.lastCall?.[1]?.headers).get("Api-Key")).toBe("panda");
  });

  it("sends partner card art from the base program on other chains", async () => {
    chainMock.id = optimism.id;
    const client = createPanda(
      { key: "panda", url: "https://panda.test" },
      { key: "base", url: "https://base.panda.test" },
    );
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(card));

    await expect(
      client.program("BASE").createCard("user-id", SIGNATURE_PRODUCT_ID, 1_000_000, undefined, Panda.partner),
    ).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://base.panda.test/issuing/users/user-id/cards",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: SIGNATURE_PRODUCT_ID, virtualCardArt: "c4c03256d6764a8390f41b60561d27af" },
        }),
      }),
    );
  });

  it("ships a us physical card with standard method", async () => {
    const physical = { ...card, type: "physical" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(physical));

    await expect(
      panda.createCard("user-id", PHYSICAL_SIGNATURE_PRODUCT_ID, 2_000_000, undefined, undefined, {
        displayName: "JOSE NUNEZ",
        line1: "123 Main St",
        line2: "Apt 4B",
        city: "San Francisco",
        region: "CA",
        postalCode: "94105",
        countryCode: "US",
        phoneNumber: "+14155551234",
      }),
    ).resolves.toStrictEqual(physical);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "physical",
          status: "active",
          limit: { amount: 2_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: PHYSICAL_SIGNATURE_PRODUCT_ID, displayName: "JOSE NUNEZ" },
          shipping: {
            line1: "123 Main St",
            line2: "Apt 4B",
            city: "San Francisco",
            region: "CA",
            postalCode: "94105",
            countryCode: "US",
            phoneNumber: "+14155551234",
            country: "United States",
            method: "standard",
          },
        }),
      }),
    );
  });

  it("ships a non-us physical card with international method", async () => {
    const physical = { ...card, type: "physical" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(physical));

    await expect(
      panda.createCard("user-id", PHYSICAL_SIGNATURE_PRODUCT_ID, undefined, undefined, undefined, {
        line1: "Av. Corrientes 1234",
        city: "Buenos Aires",
        region: "Buenos Aires",
        postalCode: "C1043",
        countryCode: "AR",
        phoneNumber: "+541143211234",
      }),
    ).resolves.toStrictEqual(physical);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "physical",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: PHYSICAL_SIGNATURE_PRODUCT_ID },
          shipping: {
            line1: "Av. Corrientes 1234",
            city: "Buenos Aires",
            region: "Buenos Aires",
            postalCode: "C1043",
            countryCode: "AR",
            phoneNumber: "+541143211234",
            country: "Argentina",
            method: "international",
          },
        }),
      }),
    );
  });

  it("rejects a physical card without shipping", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockClear();

    await expect(panda.createCard("user-id", PHYSICAL_SIGNATURE_PRODUCT_ID)).rejects.toThrow(ValiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("siwe", () => {
  it("returns the generated nonce", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response('{"nonce":"Db2ItfTPLuZ2dV0ZQ"}', { headers: { "content-type": "application/json" } }),
      );

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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response());

    await expect(panda.verify("e5cd86bb-a19e-4a66-9728-9e6c5d97e616", payload)).resolves.toStrictEqual({});
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/users/e5cd86bb-a19e-4a66-9728-9e6c5d97e616/signatures/verify"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify(payload) }),
    );
  });
});

describe("card", () => {
  const card = {
    id: "card-id",
    userId: "user-id",
    type: "virtual",
    status: "locked",
    limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
    last4: "1234",
    expirationMonth: "12",
    expirationYear: "2030",
  };
  const encrypted = { iv: "iv", data: "data" };

  afterEach(() => vi.restoreAllMocks());

  it("updates a card", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(card));

    await expect(panda.updateCard({ id: "card-id", status: "locked" })).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://panda.test/issuing/cards/card-id",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ id: "card-id", status: "locked" }) }),
    );
  });

  it("gets the encrypted secrets", async () => {
    const secrets = { encryptedPan: encrypted, encryptedCvc: encrypted };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(secrets));

    await expect(panda.getSecrets("card-id", "session")).resolves.toStrictEqual(secrets);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://panda.test/issuing/cards/card-id/secrets",
      expect.objectContaining({ method: "GET" }),
    );
    expect(new Headers(fetchSpy.mock.lastCall?.[1]?.headers).get("SessionId")).toBe("session");
  });

  it("gets the processor details", async () => {
    const details = { processorCardId: "processor", timeBasedSecret: "secret" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(details));

    await expect(panda.getProcessorDetails("card-id")).resolves.toStrictEqual(details);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://panda.test/issuing/cards/card-id/processorDetails",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("gets the encrypted pin", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ encryptedPin: encrypted }));

    await expect(panda.getPIN("card-id", "session")).resolves.toStrictEqual({ pin: encrypted });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://panda.test/issuing/cards/card-id/pin",
      expect.objectContaining({ method: "GET" }),
    );
    expect(new Headers(fetchSpy.mock.lastCall?.[1]?.headers).get("SessionId")).toBe("session");
  });

  it("returns no pin when the card has none", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json(
        { statusCode: 400, error: "BadRequestError", message: "Failed to get PIN, card does not have PIN set" },
        { status: 400 },
      ),
    );

    await expect(panda.getPIN("card-id", "session")).resolves.toStrictEqual({ pin: null });
  });

  it("rethrows other pin errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ error: "BadRequestError", message: "invalid session" }, { status: 400 }),
    );

    await expect(panda.getPIN("card-id", "session")).rejects.toMatchObject({
      name: "PandaBadRequest",
      status: 400,
      message: "invalid session",
    });
  });

  it("sets the encrypted pin", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response());

    await expect(panda.setPIN("card-id", "session", encrypted)).resolves.toStrictEqual({});
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://panda.test/issuing/cards/card-id/pin",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ encryptedPin: encrypted }) }),
    );
    expect(new Headers(fetchSpy.mock.lastCall?.[1]?.headers).get("SessionId")).toBe("session");
  });
});

describe("user", () => {
  const user = {
    id: "user-id",
    firstName: "John",
    lastName: "Doe",
    email: "john@example.com",
    isActive: false,
    applicationStatus: "approved",
    applicationReason: "",
  };

  afterEach(() => vi.restoreAllMocks());

  it("creates a user application", async () => {
    const application = {
      accountPurpose: "purchases",
      annualSalary: "100000",
      expectedMonthlyVolume: "1000",
      ipAddress: "127.0.0.1",
      isTermsOfServiceAccepted: true as const,
      occupation: "engineer",
      personaShareToken: "token",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ id: "user-id" }));

    await expect(panda.createUser(application, "evt_123")).resolves.toStrictEqual({ id: "user-id" });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://panda.test/issuing/applications/user",
      expect.objectContaining({ method: "POST", body: JSON.stringify(application) }),
    );
    expect(new Headers(fetchSpy.mock.lastCall?.[1]?.headers).get("Idempotency-Key")).toBe("user:evt_123");
  });

  it("gets the application status", async () => {
    const status = { id: "user-id", applicationStatus: "approved" };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(status));

    await expect(panda.getApplicationStatus("user-id")).resolves.toStrictEqual(status);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://panda.test/issuing/applications/user/user-id",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("updates a user", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(user));

    await expect(panda.updateUser({ id: "user-id", isActive: false })).resolves.toStrictEqual(user);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://panda.test/issuing/users/user-id",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ id: "user-id", isActive: false }) }),
    );
  });

  it("classifies users not approved as forbidden", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ message: "User not approved" }, { status: 403 }),
    );

    await expect(panda.getUser("user-id")).rejects.toMatchObject({
      name: "PandaForbidden",
      status: 403,
      message: "User not approved",
    });
  });

  it("keeps other forbidden errors unclassified", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ error: 403 }, { status: 403 }));

    await expect(panda.getUser("user-id")).rejects.toMatchObject({
      name: "Panda403",
      status: 403,
      message: '{"error":403}',
    });
  });

  it("parses json without a json content type", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json(user, { headers: { "content-type": "text/plain" } }),
    );

    await expect(panda.getUser("user-id")).resolves.toStrictEqual(user);
  });

  it("rejects a null body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(null));

    await expect(panda.getUser("user-id")).rejects.toThrow(ValiError);
  });

  it("accepts an empty json body without length", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { headers: { "content-type": "application/json" } }),
    );

    await expect(
      panda.verify("user-id", { authType: "siwe", message: "message", signature: "0x" }),
    ).resolves.toStrictEqual({});
  });

  it("keeps the deadline while reading the body", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementationOnce((_, init) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(stream) {
              init?.signal?.addEventListener("abort", () => stream.error(init.signal?.reason));
            },
          }),
        ),
      ),
    );

    const rejection = panda.getUser("user-id");
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    deadline.abort(new DOMException("timeout", "TimeoutError"));
    await expect(rejection).rejects.toThrow("timeout");
    expect(fetchSpy.mock.lastCall?.[1]?.signal).toBe(deadline.signal);
  });

  it("does not retry connection errors", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));

    const rejection = panda.getUser("user-id");
    await expect(rejection).rejects.toThrow("Connection error.");
    await expect(rejection).rejects.not.toBeInstanceOf(ServiceError);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("webhook", () => {
  it("gets a webhook", async () => {
    const webhook = {
      id: "webhook-id",
      requestBody: { id: "event-id", resource: "dispute", action: "created", body: { id: "dispute-id" } },
      requestSentAt: "2026-11-16T00:00:00.000Z",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(webhook));

    await expect(panda.getWebhook("webhook-id")).resolves.toStrictEqual(webhook);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      "https://panda.test/issuing/webhooks/webhook-id",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
