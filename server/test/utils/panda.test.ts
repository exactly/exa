import "../mocks/sentry";

import { Hono } from "hono";
import { createHmac } from "node:crypto";
import { parse } from "valibot";
import { padHex } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import { usdcAddress } from "@exactly/common/generated/chain";
import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { Address } from "@exactly/common/validation";

import createPanda, { BusinessApplicationError } from "../../utils/panda";
import * as Panda from "../../utils/panda";
import createPersona from "../../utils/persona";
import ServiceError from "../../utils/ServiceError";

const chainMock = vi.hoisted(() => ({ id: 0, testnet: true as boolean | undefined }));

vi.mock("@exactly/common/generated/chain", async (importOriginal) => ({
  ...(await importOriginal()),
  default: Object.assign(chainMock, baseSepolia, {
    rpcUrls: { ...baseSepolia.rpcUrls, alchemy: baseSepolia.rpcUrls.default },
  }),
}));

const panda = { ...Panda, ...createPanda({ key: "panda", url: "https://panda.test" }) };
const persona = createPersona("persona", "https://persona.test");

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

  it("lists company users through the parent tenant", async () => {
    const users = [{ id: "user-id", walletAddress: "0x1234" }];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(users));

    await expect(panda.getCompanyUsers("company-id")).resolves.toStrictEqual(users);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/users?companyId=company-id"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("resolves a company external id by company id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ externalId: "reference-id" }));

    await expect(panda.getCompany("company-id")).resolves.toStrictEqual({ externalId: "reference-id" });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/companies/company-id"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns nothing when the company does not exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    await expect(panda.getCompany("company-id")).resolves.toBeUndefined();
  });

  it("rethrows a company lookup failure that is not a not-found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"message":"Internal Server Error","error":"ServerError","statusCode":500}', { status: 500 }),
    );

    const rejection = panda.getCompany("company-id");
    await expect(rejection).rejects.toBeInstanceOf(ServiceError);
    await expect(rejection).rejects.toMatchObject({
      name: "PandaServer",
      status: 500,
      message: "Internal Server Error",
    });
  });
});

describe("panda webhook signature", () => {
  const payload = "payload";
  const primary = createPanda({ key: "primary", url: "https://panda.test" });
  const primaryApp = new Hono().post("/", primary.headerValidator, (c) => c.text("ok"));

  it("accepts the primary signature", async () => {
    const response = await primaryApp.request("/", {
      method: "POST",
      headers: { signature: createHmac("sha256", "primary").update(payload).digest("hex") },
      body: payload,
    });

    expect(response.status).toBe(200);
  });

  it("rejects a missing signature", async () => {
    const response = await primaryApp.request("/", { method: "POST" });

    expect(response.status).toBe(400);
  });

  it("rejects an invalid signature", async () => {
    const response = await primaryApp.request("/", {
      method: "POST",
      headers: { signature: createHmac("sha256", "invalid").update(payload).digest("hex") },
      body: payload,
    });

    expect(response.status).toBe(401);
  });
});

describe("business application", () => {
  const account = parse(Address, padHex("0xb0b", { size: 20 }));
  const fields = {
    i_company_name: { value: "Account Acme" },
    company_description: { value: "Account software" },
    company_industry: { value: "541511" },
    company_registration_number: { value: "123" },
    company_tax_id: { value: "456" },
    company_website: { value: "https://example.com" },
    i_auth_user_name: { value: "Jane" },
    i_auth_user_last_name: { value: "Doe" },
    birth_date: { value: "1990-01-01" },
    id_number: { value: "123456789" },
    id_country: { value: "US" },
    collected_email_address: { value: "jane@example.com" },
    street_1: { value: "1 Main St" },
    city: { value: "New York" },
    subdivision: { value: "NY" },
    postal_code: { value: "10001" },
    country_code: { value: "US" },
    street_1_1: { value: "1 Main St" },
    city_1: { value: "New York" },
    subdivision_1: { value: "NY" },
    postal_code_1: { value: "10001" },
    country_code_1: { value: "US" },
  };
  const address = {
    line1: "1 Main St",
    city: "New York",
    region: "NY",
    postalCode: "10001",
    countryCode: "US",
  };

  function mockBusiness({
    inquiryFields = {},
    accountFields = fields,
    accountReferenceId = "reference-id",
    inquiryStatus = "completed",
  }: {
    accountFields?: Record<string, { value: unknown }>;
    accountReferenceId?: string;
    inquiryFields?: Record<string, { value: unknown }>;
    inquiryStatus?:
      | "approved"
      | "completed"
      | "created"
      | "declined"
      | "expired"
      | "failed"
      | "needs_review"
      | "pending";
  } = {}) {
    vi.spyOn(persona, "getInquiry").mockResolvedValue({
      id: "inquiry-id",
      type: "inquiry",
      attributes: {
        status: inquiryStatus,
        "reference-id": "reference-id",
        fields: inquiryFields,
      },
    });
    vi.spyOn(persona, "getAccount").mockResolvedValue({
      id: "account-id",
      type: "account",
      attributes: { "reference-id": accountReferenceId, fields: accountFields },
      relationships: { "account-type": { data: { id: "acttp_company" } } },
    });
  }

  it("prefers account fields over inquiry fields", async () => {
    mockBusiness({
      inquiryFields: { "company-description": { value: "Inquiry software" } },
    });

    const application = await panda.businessApplication("reference-id", account, "127.0.0.1", persona);

    const person = {
      firstName: "Jane",
      lastName: "Doe",
      birthDate: "1990-01-01",
      nationalId: "123456789",
      countryOfIssue: "US",
      email: "jane@example.com",
      address: { ...address, line2: undefined },
    };
    expect(application).toStrictEqual({
      initialUser: { ...person, ipAddress: "127.0.0.1", walletAddress: account },
      name: "Account Acme",
      address: { ...address, line2: undefined },
      entity: {
        name: "Account Acme",
        description: "Account software",
        industry: "541511",
        registrationNumber: "123",
        taxId: "456",
        website: "https://example.com",
      },
      representatives: [person],
      ultimateBeneficialOwners: [],
      sourceKey: "EXA",
      externalId: "reference-id",
    });
  });

  it("falls back to inquiry fields when account field is missing", async () => {
    const incompleteFields: Record<string, { value: unknown }> = { ...fields };
    delete incompleteFields.company_description;
    mockBusiness({
      accountFields: incompleteFields,
      inquiryFields: { "company-description": { value: "Inquiry software" } },
    });

    const application = await panda.businessApplication("reference-id", account, "127.0.0.1", persona);

    expect(application.entity.description).toBe("Inquiry software");
  });

  it("rejects a mismatched reference id", async () => {
    mockBusiness();

    await expect(panda.businessApplication("other-reference-id", account, "127.0.0.1", persona)).rejects.toThrow(
      BusinessApplicationError,
    );
  });

  it("rejects a missing business account", async () => {
    mockBusiness();
    vi.mocked(persona.getAccount).mockImplementationOnce(() => Promise.resolve(undefined)); // eslint-disable-line unicorn/no-useless-undefined

    await expect(panda.businessApplication("reference-id", account, "127.0.0.1", persona)).rejects.toMatchObject({
      message: "business account not started",
      code: "not started",
    });
  });

  it("rejects a business account field with the wrong type", async () => {
    mockBusiness({ accountFields: { ...fields, i_company_name: { value: 123 } } });

    await expect(panda.businessApplication("reference-id", account, "127.0.0.1", persona)).rejects.toMatchObject({
      message: "invalid business Persona fields",
      code: "bad request",
    });
  });

  it.each([[null], [""], ["   "], ["Suite 2"]] as const)("normalizes a line2 value %s", async (line2) => {
    mockBusiness({ accountFields: { ...fields, street_2: { value: line2 } } });
    const application = await panda.businessApplication("reference-id", account, "127.0.0.1", persona);
    expect(application.address.line2).toBe(typeof line2 === "string" ? line2.trim() || undefined : undefined);
  });

  it("rejects a malformed line2 value", async () => {
    mockBusiness({ accountFields: { ...fields, street_2: { value: 123 } } });

    await expect(panda.businessApplication("reference-id", account, "127.0.0.1", persona)).rejects.toMatchObject({
      message: "invalid business Persona fields",
      code: "bad request",
    });
  });

  it("rejects malformed business account attributes", async () => {
    vi.spyOn(persona, "getInquiry").mockResolvedValue({
      id: "inquiry-id",
      type: "inquiry",
      attributes: { status: "completed", "reference-id": "reference-id", fields: {} },
    });
    vi.spyOn(persona, "getAccount").mockResolvedValue({
      id: "account-id",
      type: "account",
      attributes: { "reference-id": "reference-id", fields: { company_name: "malformed" } },
      relationships: { "account-type": { data: { id: "acttp_company" } } },
    } as never);
    await expect(panda.businessApplication("reference-id", account, "127.0.0.1", persona)).rejects.toMatchObject({
      message: "business account is not complete",
      code: "processing",
    });
  });

  it("rejects semantic company-field validation failures", async () => {
    mockBusiness({ accountFields: { ...fields, company_website: { value: "not a url" } } });
    await expect(panda.businessApplication("reference-id", account, "127.0.0.1", persona)).rejects.toMatchObject({
      message: "invalid business Persona fields",
      code: "bad request",
    });
  });

  it("rejects a mismatched business account", async () => {
    mockBusiness({ accountReferenceId: "other-reference-id" });

    await expect(panda.businessApplication("reference-id", account, "127.0.0.1", persona)).rejects.toMatchObject({
      message: "business account is not complete",
      code: "processing",
    });
  });

  it("rejects a missing client IP address", async () => {
    mockBusiness();

    await expect(panda.businessApplication("reference-id", account, undefined, persona)).rejects.toThrow(
      BusinessApplicationError,
    );
  });

  it.each([
    ["created", "business inquiry is not started", "not started"],
    ["expired", "business inquiry is not started", "not started"],
    ["pending", "business inquiry is not started", "not started"],
    ["failed", "business inquiry failed", "bad kyb"],
    ["declined", "business inquiry failed", "bad kyb"],
    ["needs_review", "business inquiry is not complete", "processing"],
  ] as const)("rejects a %s inquiry", async (inquiryStatus, message, code) => {
    mockBusiness({ inquiryStatus });

    await expect(panda.businessApplication("reference-id", account, "127.0.0.1", persona)).rejects.toMatchObject({
      message,
      code,
    });
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

  it("creates a company application with and without an idempotency key", async () => {
    const application = {
      initialUser: {
        firstName: "Jane",
        lastName: "Doe",
        birthDate: "1990-01-01",
        nationalId: "123456789",
        countryOfIssue: "US",
        email: "jane@example.com",
        ipAddress: "127.0.0.1",
        walletAddress: account,
        address,
      },
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
      representatives: [],
      ultimateBeneficialOwners: [],
      sourceKey: "EXA",
      externalId: "reference-id",
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ id: "company-1", name: "Account Acme", address }))
      .mockResolvedValueOnce(Response.json({ id: "company-1", name: "Account Acme", address }));

    await panda.createCompanyApplication(application, { idempotencyKey: "business-application:reference-id" });
    await panda.createCompanyApplication(application);

    const [keyed, plain] = fetchSpy.mock.calls.slice(-2);
    if (!keyed || !plain) throw new Error("missing panda requests");
    const raw = keyed[1]?.body;
    if (typeof raw !== "string") throw new Error("missing panda request body");
    expect(JSON.parse(raw)).toStrictEqual(application);
    expect(keyed[0]).toEqual(expect.stringContaining("/issuing/applications/company"));
    expect(keyed[1]?.headers).toMatchObject({
      "Idempotency-Key": "business-application:reference-id",
    });
    expect(plain[1]?.headers).not.toHaveProperty("Idempotency-Key");
  });
});

describe("mutex", () => {
  it("purges the mutex entry after the exclusive run", async () => {
    const account = parse(Address, "0x29684075a3C86ea11D9964BcAf0F956e801396bD");
    await Panda.withMutex(account, async () => {
      expect(Panda.getMutex(account)).toBeDefined();
    });
    expect(Panda.getMutex(account)).toBeUndefined();
  });

  it("serializes concurrent exclusive runs for the same account", async () => {
    const account = parse(Address, "0x29684075a3C86ea11D9964BcAf0F956e801396bD");
    const order: string[] = [];
    const run = (name: string) =>
      Panda.withMutex(account, async () => {
        order.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push(`${name}:end`);
      });
    await Promise.all([run("a"), run("b")]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
    expect(Panda.getMutex(account)).toBeUndefined();
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

  it("sends an idempotency key and custom limit", async () => {
    chainMock.id = baseSepolia.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(card));

    await panda.createCard("user-id", SIGNATURE_PRODUCT_ID, { amount: 123, idempotencyKey: "approval-key" });
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 123, frequency: "per7DayPeriod" },
          configuration: { productId: SIGNATURE_PRODUCT_ID, virtualCardArt: "0c515d7eb0a140fa8f938f8242b0780a" },
        }),
      }),
    );
    const [, init] = fetchSpy.mock.lastCall ?? [];
    expect(init?.headers).toMatchObject({ "Idempotency-Key": "approval-key" });
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
