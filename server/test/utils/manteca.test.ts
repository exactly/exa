import "../mocks/sentry";

import { parse } from "valibot";
import { padHex } from "viem";
import { optimism, optimismSepolia } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Address } from "@exactly/common/validation";

import createPersona from "../../utils/persona";
import createManteca, * as Manteca from "../../utils/ramps/manteca";
import { ErrorCodes } from "../../utils/ramps/manteca";
import ServiceError from "../../utils/ServiceError";

import type * as viem from "viem";

const chainMock = vi.hoisted(() => ({ id: 10 }));

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

vi.mock("@exactly/common/generated/chain", () => ({
  default: chainMock,
}));

const persona = createPersona("persona", "https://persona.test");
const ramp = createManteca("manteca", "https://manteca.test");
const manteca = {
  ...Manteca,
  ...ramp,
  onboarding: (account: Parameters<typeof ramp.onboarding>[0], credentialId: string) =>
    ramp.onboarding(account, credentialId, persona),
};

function mockFetchResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).buffer),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function mockFetchError(status: number, message: string) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(message),
  } as Response;
}

describe("manteca utils", () => {
  beforeEach(() => {
    chainMock.id = optimism.id;
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      body: new ReadableStream(),
      headers: new Headers(),
      json: () => Promise.resolve({}),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      text: () => Promise.resolve(""),
    } as Response);
  });

  afterEach(() => vi.restoreAllMocks());

  describe("getDepositDetails", () => {
    it("returns ARS deposit details for argentina", () => {
      const details = manteca.getDepositDetails("ARS", "ARGENTINA");

      expect(details).toHaveLength(1);
      expect(details[0]).toMatchObject({
        depositAlias: "exa.ars",
        cbu: "0000234100000000000529",
        network: "ARG_FIAT_TRANSFER",
        displayName: "CVU",
      });
    });

    it("returns USD deposit details for argentina", () => {
      const details = manteca.getDepositDetails("USD", "ARGENTINA");

      expect(details).toHaveLength(1);
      expect(details[0]).toMatchObject({
        cbu: "4310009942700000124934",
        depositAlias: "exa.usd",
        network: "ARG_FIAT_TRANSFER",
        displayName: "CBU",
      });
    });

    it("returns BRL deposit details for brazil", () => {
      const details = manteca.getDepositDetails("BRL", "BRAZIL");

      expect(details).toHaveLength(1);
      expect(details[0]).toMatchObject({
        pixKey: "100d6f24-c507-43a1-935c-ba3fb9d1c16d", // gitleaks:allow public PIX deposit key; not a credential
        merchantCity: "São Paulo",
        network: "PIX",
        displayName: "PIX KEY",
        postalCode: "09751-000",
      });
    });

    it("throws for unsupported currency-exchange combination", () => {
      expect(() => manteca.getDepositDetails("ARS", "BRAZIL")).toThrow(ErrorCodes.NOT_SUPPORTED_CURRENCY);
    });
  });

  describe("getUser", () => {
    const account: Address = parse(Address, padHex("0x1", { size: 20 }));

    it("returns user when found", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(mockActiveUser));

      const result = await manteca.getUser(account);

      expect(result).toMatchObject({ id: "123", numberId: "456", status: "ACTIVE" });
    });

    it("returns null when user not found", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchError(404, "USER_NF"));

      const result = await manteca.getUser(account);

      expect(result).toBeNull();
    });

    it("throws on other errors", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchError(500, "internal error"));

      const rejection = manteca.getUser(account);
      await expect(rejection).rejects.toBeInstanceOf(ServiceError);
      await expect(rejection).rejects.toMatchObject({
        name: "Manteca500",
        status: 500,
        message: "internal error",
        cause: "internal error",
      });
    });

    it("extracts field path from errors array stripping pii", async () => {
      const body =
        '{"internalStatus":"BAD_REQUEST","message":"Bad request.","errors":["personalData..phoneNumber has wrong value *1234567890"]}';
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchError(400, body));

      const rejection = manteca.getUser(account);
      await expect(rejection).rejects.toBeInstanceOf(ServiceError);
      await expect(rejection).rejects.toMatchObject({
        name: "MantecaBadRequest",
        status: 400,
        message: "personalData..phoneNumber has wrong value",
        cause: body,
      });
    });

    it("falls back to message when errors array is absent", async () => {
      const body = '{"internalStatus":"BAD_REQUEST","message":"Bad request."}';
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchError(400, body));

      const rejection = manteca.getUser(account);
      await expect(rejection).rejects.toMatchObject({ name: "MantecaBadRequest", message: "Bad request." });
    });

    it("keeps errors entry without has wrong value pattern", async () => {
      const body = '{"internalStatus":"BAD_REQUEST","errors":["personalData..email is required"]}';
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchError(400, body));

      const rejection = manteca.getUser(account);
      await expect(rejection).rejects.toMatchObject({
        name: "MantecaBadRequest",
        message: "personalData..email is required",
      });
    });

    it("falls back to generic classification without internalStatus", async () => {
      const body = '{"message":"something went wrong"}';
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchError(422, body));

      const rejection = manteca.getUser(account);
      await expect(rejection).rejects.toMatchObject({ name: "Manteca422", message: "something went wrong" });
    });
  });

  describe("getQuote", () => {
    it("returns transformed quote response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchResponse({
          ticker: "USDC_ARS",
          timestamp: "2024-01-01T00:00:00Z",
          buy: "1000.00",
          sell: "990.00",
        }),
      );

      const result = await manteca.getQuote("USDC_ARS");

      expect(result).toEqual({
        buyRate: "1000.00",
        sellRate: "990.00",
      });
    });

    it("returns undefined on error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchError(500, "error"));

      const result = await manteca.getQuote("USDC_ARS");

      expect(result).toBeUndefined();
    });
  });

  describe("convertBalanceToUsdc", () => {
    it("converts balance to usdc", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchResponse({ ...mockBalanceBase, balance: { ARS: "1000.00" } }))
        .mockResolvedValueOnce(mockFetchResponse({ ...mockOrderResponse, status: "COMPLETED" }));

      await expect(manteca.convertBalanceToUsdc("456", "ARS")).resolves.toBeUndefined();

      const orderCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(orderCall?.[1]?.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({
        userAnyId: "456",
        side: "BUY",
        disallowDebt: true,
        asset: "USDC",
        against: "ARS",
        againstAmount: "1000.00",
      });
    });

    it("throws when asset balance not found", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse({ ...mockBalanceBase, balance: {} }));

      await expect(manteca.convertBalanceToUsdc("456", "ARS")).rejects.toThrow("asset balance not found");
    });

    it("throws INVALID_ORDER_SIZE on MIN_SIZE error", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchResponse({ ...mockBalanceBase, balance: { ARS: "1.00" } }))
        .mockResolvedValueOnce(mockFetchError(400, "MIN_SIZE"));

      await expect(manteca.convertBalanceToUsdc("456", "ARS")).rejects.toThrow(ErrorCodes.INVALID_ORDER_SIZE);
    });
  });

  describe("withdrawBalance", () => {
    const address: Address = parse(Address, padHex("0x1", { size: 20 }));

    it("withdraws balance", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchResponse({ ...mockBalanceBase, balance: { USDC: "100.00" } }))
        .mockResolvedValueOnce(mockFetchResponse(mockWithdrawResponse));

      await expect(manteca.withdrawBalance("456", "USDC", address)).resolves.toBeUndefined();

      const withdrawCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(withdrawCall?.[1]?.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({
        userAnyId: "456",
        asset: "USDC",
        amount: "100.00",
        destination: { address, network: "OPTIMISM" },
      });
    });

    it("throws when asset balance not found", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse({ ...mockBalanceBase, balance: {} }));

      await expect(manteca.withdrawBalance("456", "USDC", address)).rejects.toThrow("asset balance not found");
    });

    it("throws for unsupported chain id", async () => {
      chainMock.id = 1;
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchResponse({ ...mockBalanceBase, balance: { USDC: "100.00" } }),
      );

      await expect(manteca.withdrawBalance("456", "USDC", address)).rejects.toThrow(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
    });

    it("withdraws with OPTIMISM network on development chain", async () => {
      chainMock.id = optimismSepolia.id;
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchResponse({ ...mockBalanceBase, balance: { USDC: "100.00" } }))
        .mockResolvedValueOnce(mockFetchResponse(mockWithdrawResponse));

      await expect(manteca.withdrawBalance("456", "USDC", address)).resolves.toBeUndefined();

      const withdrawCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(withdrawCall?.[1]?.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({
        destination: { address, network: "OPTIMISM" },
      });
    });
  });

  describe("getProvider", () => {
    const account: Address = parse(Address, padHex("0x1", { size: 20 }));

    it("returns NOT_STARTED when user does not exist", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("USER_NF"),
      } as Response);

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("NOT_STARTED");
    });

    it("returns ACTIVE status and limits when user is ACTIVE", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchResponse(mockActiveUser))
        .mockResolvedValueOnce(mockFetchResponse(mockLimitsResponse));

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("ACTIVE");
      expect((result.onramp as Record<string, unknown>).limits).toEqual({
        monthly: { available: "8000.00", limit: "10000.00", symbol: "USD" },
        yearly: { available: "95000.00", limit: "100000.00", symbol: "USD" },
      });
    });

    it("returns no limits when limits response is empty", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchResponse(mockActiveUser))
        .mockResolvedValueOnce(mockFetchResponse([]));

      const result = await manteca.getProvider(account, "AR");

      expect((result.onramp as Record<string, unknown>).limits).toBeUndefined();
    });

    it("returns no limits when no EXCHANGE type limit found", async () => {
      const remittanceLimits = [{ ...mockLimitsResponse[0], type: "REMITTANCE" }];
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchResponse(mockActiveUser))
        .mockResolvedValueOnce(mockFetchResponse(remittanceLimits));

      const result = await manteca.getProvider(account, "AR");

      expect((result.onramp as Record<string, unknown>).limits).toBeUndefined();
    });

    it("returns ACTIVE with no limits when limits fetch fails", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchResponse(mockActiveUser))
        .mockResolvedValueOnce(mockFetchError(500, "limits error"));

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("ACTIVE");
      expect((result.onramp as Record<string, unknown>).limits).toBeUndefined();
    });

    it("returns NOT_AVAILABLE when user status is INACTIVE", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(mockInactiveUser));

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("NOT_AVAILABLE");
    });

    it("returns NOT_STARTED when user has pending required tasks", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchResponse({
          ...mockOnboardingUser,
          onboarding: {
            EMAIL_VALIDATION: { required: true, status: "PENDING" },
            IDENTITY_DECLARATION: { required: true, status: "COMPLETED" },
          },
        }),
      );

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("NOT_STARTED");
    });

    it("returns CONTACT_SUPPORT when user has failed required tasks", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchResponse({
          ...mockOnboardingUser,
          onboarding: {
            EMAIL_VALIDATION: { required: true, status: "COMPLETED" },
            IDENTITY_VALIDATION: { required: true, status: "FAILED", rejectionReason: "document unreadable" },
          },
        }),
      );

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("CONTACT_SUPPORT");
    });

    it("prioritizes CONTACT_SUPPORT over pending required tasks", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchResponse({
          ...mockOnboardingUser,
          onboarding: {
            EMAIL_VALIDATION: { required: true, status: "PENDING" },
            IDENTITY_VALIDATION: { required: true, status: "FAILED" },
          },
        }),
      );

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("CONTACT_SUPPORT");
    });

    it("ignores failed tasks that are not required", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchResponse({
          ...mockOnboardingUser,
          onboarding: {
            EMAIL_VALIDATION: { required: true, status: "COMPLETED" },
            IDENTITY_VALIDATION: { required: false, status: "FAILED" },
          },
        }),
      );

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("ONBOARDING");
    });

    it("returns ONBOARDING when user has no pending required tasks", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchResponse({
          ...mockOnboardingUser,
          onboarding: {
            EMAIL_VALIDATION: { required: true, status: "COMPLETED" },
            IDENTITY_DECLARATION: { required: false, status: "PENDING" },
            BASIC_PERSONAL_DATA_DEFINITION: { required: true, status: "IN_PROGRESS" },
          },
        }),
      );

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("ONBOARDING");
    });

    it("handles onboarding with only some tasks defined without throwing", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchResponse({
          ...mockOnboardingUser,
          onboarding: { EMAIL_VALIDATION: { required: true, status: "PENDING" } },
        }),
      );

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("NOT_STARTED");
    });

    it("handles empty onboarding object without throwing", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(mockOnboardingUser));

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("ONBOARDING");
    });

    it("returns NOT_AVAILABLE for unsupported chain id", async () => {
      chainMock.id = 1;

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("NOT_AVAILABLE");
      expect(result.onramp.currencies).toEqual([]);
    });

    it("returns currencies on development chain", async () => {
      chainMock.id = optimismSepolia.id;
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("USER_NF"),
      } as Response);

      const result = await manteca.getProvider(account, "AR");

      expect(result.status).toBe("NOT_STARTED");
      expect(result.onramp.currencies).toEqual(["ARS", "USD"]);
    });
  });

  describe("mantecaOnboarding", () => {
    const account: Address = parse(Address, padHex("0x1", { size: 20 }));
    const credentialId = "credential-123";

    const mockIdentityDocument = {
      id_class: { value: "dl" },
      id_number: { value: "123456" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc-123" },
    };

    const mockPersonaAccount = {
      id: "account-123",
      type: "account" as const,
      attributes: {
        "country-code": "AR",
        "email-address": "test@example.com",
        "name-first": "John",
        "name-middle": null,
        "name-last": "Doe",
        "address-street-1": "123 Main St",
        "address-street-2": null,
        "address-city": "Buenos Aires",
        "address-subdivision": "CABA", // cspell:ignore CABA
        "address-postal-code": "1000",
        "social-security-number": null,
        "phone-number": "+5491123456789",
        birthdate: "1990-01-01",
        fields: {
          name: { value: { first: { value: "John" }, middle: { value: null }, last: { value: "Doe" } } },
          address: {
            value: {
              street_1: { value: "123 Main St" },
              street_2: { value: null },
              city: { value: "Buenos Aires" },
              subdivision: { value: "CABA" },
              postal_code: { value: "1000" },
              country_code: { value: "AR" },
            },
          },
          birthdate: { value: "1990-01-01" },
          phone_number: { value: "+5491123456789" },
          email_address: { value: "test@example.com" },
          selfie_photo: { value: { filename: "selfie.jpg", url: "https://example.com/selfie.jpg" } },
          rain_e_sign_consent: { value: true },
          exa_card_tc: { value: true },
          privacy__policy: { value: true },
          account_opening_disclosure: { value: null },
          economic_activity: { value: "Developer" },
          annual_salary: { value: "50000" },
          expected_monthly_volume: { value: "1000" },
          accurate_info_confirmation: { value: true },
          non_unauthorized_solicitation: { value: true },
          non_illegal_activities_2: { value: "No" as const },
          documents: { value: [{ value: mockIdentityDocument }] },
          isnotfacta: { value: true }, // cspell:ignore isnotfacta
          tin: { value: "12345678" },
          sex_1: { value: "Male" as const },
          manteca_t_c: { value: true },
        },
      },
    };

    const mockDocument = {
      id: "doc-123",
      attributes: {
        "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
        "back-photo": { filename: "back.jpg", url: "https://example.com/back.jpg" },
        "selfie-photo": null,
        "id-class": "dl",
      },
    };

    it("throws for unsupported chain id", async () => {
      chainMock.id = 1;

      await expect(manteca.onboarding(account, credentialId)).rejects.toThrow(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
    });

    it("returns early when user is already active", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(mockActiveUser));

      await expect(manteca.onboarding(account, credentialId)).resolves.toBeUndefined();
    });

    it("throws when user is inactive", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(mockInactiveUser));

      await expect(manteca.onboarding(account, credentialId)).rejects.toThrow(ErrorCodes.MANTECA_USER_INACTIVE);
    });

    it("throws when no persona account found", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchError(404, "USER_NF"));
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

      await expect(manteca.onboarding(account, credentialId)).rejects.toThrow(ErrorCodes.NO_PERSONA_ACCOUNT);
    });

    it("throws when no identity document found", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchError(404, "USER_NF"))
        .mockResolvedValueOnce(mockFetchResponse(mockNewUserResponse));
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce(mockPersonaAccount);
      vi.spyOn(persona, "getDocumentForManteca").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

      await expect(manteca.onboarding(account, credentialId)).rejects.toThrow(ErrorCodes.NO_DOCUMENT);
    });

    it("throws when front document URL not found", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchError(404, "USER_NF"))
        .mockResolvedValueOnce(mockFetchResponse(mockNewUserResponse));
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce(mockPersonaAccount);
      vi.spyOn(persona, "getDocumentForManteca").mockResolvedValueOnce(mockIdentityDocument);
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce({
        ...mockDocument,
        attributes: { ...mockDocument.attributes, "front-photo": null },
      });

      await expect(manteca.onboarding(account, credentialId)).rejects.toThrow("front document URL not found");
    });

    it("throws INVALID_LEGAL_ID when initiateOnboarding returns legalId error", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchError(404, "USER_NF"))
        .mockResolvedValueOnce(
          mockFetchError(
            400,
            '{"internalStatus":"BAD_REQUEST","message":"Bad request.","errors":["legalId has wrong value 20991231239"]}',
          ),
        );
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce(mockPersonaAccount);
      vi.spyOn(persona, "getDocumentForManteca").mockResolvedValueOnce(mockIdentityDocument);

      await expect(manteca.onboarding(account, credentialId)).rejects.toThrow(ErrorCodes.INVALID_LEGAL_ID);
    });

    it("initiates onboarding for new user", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchError(404, "USER_NF"))
        .mockResolvedValueOnce(mockFetchResponse(mockNewUserResponse))
        .mockResolvedValueOnce(mockFetchResponse({ url: "https://presigned.url/front" }))
        .mockResolvedValueOnce(mockFetchResponse({ url: "https://presigned.url/back" }))
        .mockResolvedValueOnce(mockFetchResponse({}));

      vi.spyOn(persona, "getAccount").mockResolvedValueOnce(mockPersonaAccount);
      vi.spyOn(persona, "getDocumentForManteca").mockResolvedValueOnce(mockIdentityDocument);
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce(mockDocument);

      await expect(manteca.onboarding(account, credentialId)).resolves.toBeUndefined();
    });

    it("skips initiateOnboarding for existing onboarding user", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchResponse(mockOnboardingUser))
        .mockResolvedValueOnce(mockFetchResponse({ url: "https://presigned.url/front" }))
        .mockResolvedValueOnce(mockFetchResponse({ url: "https://presigned.url/back" }))
        .mockResolvedValueOnce(mockFetchResponse({}));

      vi.spyOn(persona, "getAccount").mockResolvedValueOnce(mockPersonaAccount);
      vi.spyOn(persona, "getDocumentForManteca").mockResolvedValueOnce(mockIdentityDocument);
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce(mockDocument);

      await expect(manteca.onboarding(account, credentialId)).resolves.toBeUndefined();
    });

    it("handles female sex mapping", async () => {
      const femalePersonaAccount = {
        ...mockPersonaAccount,
        attributes: {
          ...mockPersonaAccount.attributes,
          fields: { ...mockPersonaAccount.attributes.fields, sex_1: { value: "Female" as const } },
        },
      };

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchError(404, "USER_NF"))
        .mockResolvedValueOnce(mockFetchResponse(mockNewUserResponse))
        .mockResolvedValueOnce(mockFetchResponse({ url: "https://presigned.url/front" }))
        .mockResolvedValueOnce(mockFetchResponse({ url: "https://presigned.url/back" }))
        .mockResolvedValueOnce(mockFetchResponse({}));

      vi.spyOn(persona, "getAccount").mockResolvedValueOnce(femalePersonaAccount);
      vi.spyOn(persona, "getDocumentForManteca").mockResolvedValueOnce(mockIdentityDocument);
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce(mockDocument);

      await manteca.onboarding(account, credentialId);

      const initiateCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(initiateCall?.[1]?.body as string) as { personalData: { sex: string } };
      expect(body.personalData.sex).toBe("F");
    });

    it("handles non-binary sex mapping", async () => {
      const nonBinaryPersonaAccount = {
        ...mockPersonaAccount,
        attributes: {
          ...mockPersonaAccount.attributes,
          fields: { ...mockPersonaAccount.attributes.fields, sex_1: { value: "Prefer not to say" as const } },
        },
      };

      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchError(404, "USER_NF"))
        .mockResolvedValueOnce(mockFetchResponse(mockNewUserResponse))
        .mockResolvedValueOnce(mockFetchResponse({ url: "https://presigned.url/front" }))
        .mockResolvedValueOnce(mockFetchResponse({ url: "https://presigned.url/back" }))
        .mockResolvedValueOnce(mockFetchResponse({}));

      vi.spyOn(persona, "getAccount").mockResolvedValueOnce(nonBinaryPersonaAccount);
      vi.spyOn(persona, "getDocumentForManteca").mockResolvedValueOnce(mockIdentityDocument);
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce(mockDocument);

      await manteca.onboarding(account, credentialId);

      const initiateCall = fetchSpy.mock.calls[1];
      const body = JSON.parse(initiateCall?.[1]?.body as string) as { personalData: { sex: string } };
      expect(body.personalData.sex).toBe("X");
    });
  });

  describe("lockQrPayment", () => {
    it("locks with the real payer as sender", async () => {
      const lock = {
        code: "fa44218d-7b3c-4a1e-bc9f-2d5e8f01c3a7",
        type: "QR3",
        companyId: "64a1b2c3d4e5f6a7b8c9d0e1",
        userId: "64a1b2c3d4e5f6a7b8c9d0e2",
        userNumberId: "12345",
        userExternalId: "ext-001",
        sender: { exchange: "ARGENTINA", legalId: "12345678", name: "JANE", surname: "DOE" },
        paymentRecipientName: "Merchant",
        paymentRecipientLegalId: "30712345678",
        paymentAssetAmount: "15000.00",
        paymentAsset: "ARS",
        paymentPrice: "1250.50",
        paymentAgainstAmount: "12.00",
        expireAt: "2026-02-21T15:30:00.000Z",
        creationTime: "2026-02-21T15:25:00.000Z",
      };
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(lock));
      const sender = { legalIdNationality: "ARGENTINA", legalId: "12345678", name: "JANE", surname: "DOE" };

      await expect(
        manteca.lockQrPayment({ paymentDestination: "qr3", against: "USDC", sender }),
      ).resolves.toStrictEqual({ ...lock, sender: { legalId: "12345678" } });

      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://manteca.test/crypto/v2/payment-locks");
      expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe("POST");
      expect(JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string)).toStrictEqual({
        paymentDestination: "qr3",
        against: "USDC",
        sender,
      });
    });
  });

  it("parses a lock without amount", async () => {
    const lock = {
      code: "",
      type: "QR3",
      companyId: "68a6270d62a6d9f582f40c00",
      userId: "6adff39f0ee31861fc20cdaf",
      userNumberId: "100114168",
      userExternalId: "Exactly-argentina",
      paymentAsset: "ARS",
      paymentAgainst: "USDC",
      paymentRecipientName: "Ricardo Fort",
      paymentRecipientLegalId: "27295426294",
      paymentAssetAmount: "0",
      paymentAgainstAmount: "0",
      expireAt: "2026-11-11T16:39:17.205-03:00",
      creationTime: "2026-11-11T16:39:17.205-03:00",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(lock));

    await expect(
      manteca.lockQrPayment({
        paymentDestination: "qr3manualamount", // cspell:ignore manualamount
        against: "USDC",
        sender: { legalIdNationality: "AR", legalId: "30123456", name: "Juan", surname: "Perez" },
      }),
    ).resolves.toStrictEqual({
      code: "",
      type: "QR3",
      companyId: lock.companyId,
      userId: lock.userId,
      userNumberId: "100114168",
      userExternalId: "Exactly-argentina",
      paymentRecipientName: "Ricardo Fort",
      paymentRecipientLegalId: "27295426294",
      paymentAsset: "ARS",
      paymentAssetAmount: "0",
      paymentAgainstAmount: "0",
      expireAt: lock.expireAt,
      creationTime: lock.creationTime,
    });
  });

  describe("executeQrPayment", () => {
    const synthetic = {
      id: "6af20ec32e3420b0fdc3e1d0",
      numberId: "70009",
      externalId: "0xabc",
      status: "STARTING",
      type: "QR3_PAYMENT",
    };
    const body = {
      ...synthetic,
      userId: "6adff39f0ee31861fc20cdaf",
      userNumberId: "100114168",
      userExternalId: "Exactly-argentina",
      platform: "CRIPTO", // cspell:ignore CRIPTO
      details: {
        sender: { exchange: "ARGENTINA", legalId: "30123456", name: "JANE", surname: "DOE" },
        paymentAssetAmount: "1265.67",
        paymentAsset: "ARS",
        paymentAgainstAmount: "1.81",
        paymentAgainst: "USDC",
      },
    };

    it("executes the lock with the external id", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(body));

      await expect(manteca.executeQrPayment("lock-code", "0xabc")).resolves.toStrictEqual(synthetic);

      expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://manteca.test/crypto/v2/synthetics/qr-payment");
      expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe("POST");
      expect(JSON.parse(fetchSpy.mock.calls[0]?.[1]?.body as string)).toStrictEqual({
        qrCode: "lock-code",
        externalId: "0xabc",
      });
    });

    it.each([
      [409, { internalStatus: "SYNTHETIC_EXISTS", message: "Synthetic exists" }],
      [400, { internalStatus: "DUPLICATE_REQUEST", message: "Same request executed too many times." }],
    ])("returns the existing synthetic on %i %o", async (status, error) => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchError(status, JSON.stringify(error)))
        .mockResolvedValueOnce(mockFetchResponse({ ...body, status: "COMPLETED" }));

      await expect(manteca.executeQrPayment("lock-code", "0xabc")).resolves.toStrictEqual({
        ...synthetic,
        status: "COMPLETED",
      });

      expect(fetchSpy.mock.calls[1]?.[0]).toBe("https://manteca.test/crypto/v2/synthetics/0xabc");
      expect(fetchSpy.mock.calls[1]?.[1]?.method).toBe("GET");
    });

    it("throws when the existing synthetic is not found", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          mockFetchError(
            400,
            JSON.stringify({ internalStatus: "DUPLICATE_REQUEST", message: "Same request executed too many times." }),
          ),
        )
        .mockResolvedValueOnce(
          mockFetchError(404, JSON.stringify({ internalStatus: "SYNTHETIC_NF", message: "Synthetic not found" })),
        );

      await expect(manteca.executeQrPayment("lock-code", "0xabc")).rejects.toThrow(ServiceError);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("throws on other 409 errors", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          mockFetchError(409, JSON.stringify({ internalStatus: "OPERATION_BLOCKED", message: "blocked" })),
        );

      await expect(manteca.executeQrPayment("lock-code", "0xabc")).rejects.toThrow(ServiceError);
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
  });

  describe("getPaymentLock", () => {
    it("returns the lock with its sender", async () => {
      const lock = {
        code: "1389ce57-0098-443b-b833-7c1ec6757f8c",
        type: "QR3",
        companyId: "68a6270d62a6d9f582f40c00",
        userId: "6adff39f0ee31861fc20cdaf",
        userNumberId: "100114168",
        userExternalId: "Exactly-argentina",
        sender: { exchange: "ARGENTINA", legalId: "30123456", name: "Juan", surname: "Perez" },
        paymentRecipientName: "Diego Maradona", // cspell:ignore Maradona
        paymentRecipientLegalId: "20814518820",
        paymentAssetAmount: "3441.05",
        paymentAsset: "ARS",
        paymentPrice: "696.63000000",
        paymentEffectivePrice: "696.62999961",
        paymentAgainstAmount: "4.93956620",
        paymentAgainst: "USDC",
        expireAt: "2026-11-11T16:12:43.000-03:00",
        creationTime: "2026-11-11T16:07:43.634-03:00",
      };
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchResponse(lock));

      await expect(manteca.getPaymentLock(lock.code)).resolves.toStrictEqual({
        code: lock.code,
        type: "QR3",
        companyId: lock.companyId,
        userId: lock.userId,
        userNumberId: "100114168",
        userExternalId: "Exactly-argentina",
        sender: { legalId: "30123456" },
        paymentRecipientName: "Diego Maradona",
        paymentRecipientLegalId: "20814518820",
        paymentAssetAmount: "3441.05",
        paymentAsset: "ARS",
        paymentPrice: "696.63000000",
        paymentAgainstAmount: "4.93956620",
        expireAt: lock.expireAt,
        creationTime: lock.creationTime,
      });
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`https://manteca.test/crypto/v2/payment-locks/${lock.code}`);
      expect(fetchSpy.mock.calls[0]?.[1]?.method).toBe("GET");
    });

    it("returns null for an expired lock", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchError(400, JSON.stringify({ internalStatus: "EXPIRED_LOCK", message: "Expired price code." })),
      );

      await expect(manteca.getPaymentLock("lock-code")).resolves.toBeNull();
    });

    it("throws on other errors", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchError(500, "internal"));

      await expect(manteca.getPaymentLock("lock-code")).rejects.toThrow(ServiceError);
    });
  });

  describe("getSynthetic", () => {
    it("returns the synthetic by external id", async () => {
      const synthetic = {
        id: "6af4be64204ef0670ed08a32",
        numberId: "70528",
        externalId: padHex("0x4337", { size: 32 }),
        status: "ACTIVE",
        type: "QR3_PAYMENT",
      };
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchResponse({ ...synthetic, userExternalId: "Exactly-argentina" }));

      await expect(manteca.getSynthetic(synthetic.externalId)).resolves.toStrictEqual(synthetic);
      expect(fetchSpy.mock.calls[0]?.[0]).toBe(`https://manteca.test/crypto/v2/synthetics/${synthetic.externalId}`);
    });

    it("returns null when the synthetic is not found", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchError(404, JSON.stringify({ internalStatus: "SYNTHETIC_NF", message: "Synthetic not found" })),
      );

      await expect(manteca.getSynthetic("0xabc")).resolves.toBeNull();
    });

    it("throws on other errors", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(mockFetchError(500, "internal"));

      await expect(manteca.getSynthetic("0xabc")).rejects.toThrow(ServiceError);
    });
  });

  describe("getSettlement", () => {
    it("returns the evm settlement address of the entity and memoizes the company", async () => {
      const evm = ["ETHEREUM", "OPTIMISM", "BASE"];
      const settlements = createManteca("manteca", "https://manteca.test");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        mockFetchResponse({
          id: "68a6270d62a6d9f582f40c00",
          banking: {
            addresses: [
              {
                acceptedNetworks: ["TRON"],
                legalEntity: "WALLET_ARG",
                address: "TD5SNtuAf2gCcbzcwBtHyYwGcfuSfJJxY3",
                type: "SETTLEMENT",
              }, // cspell:ignore TD5SNtuAf2gCcbzcwBtHyYwGcfuSfJJxY3
              {
                acceptedNetworks: evm,
                legalEntity: "WALLET_ARG",
                address: padHex("0xc0", { size: 20 }),
                type: "COLLECT",
              },
              {
                acceptedNetworks: evm,
                legalEntity: "WALLET_ARG",
                address: padHex("0xa5", { size: 20 }),
                type: "SETTLEMENT",
              },
              {
                acceptedNetworks: evm,
                legalEntity: "CRYPTO_GLOBAL",
                address: padHex("0xb1", { size: 20 }),
                type: "SETTLEMENT",
              },
            ],
          },
        }),
      );

      await expect(settlements.getSettlements()).resolves.toStrictEqual({
        ARS: parse(Address, padHex("0xa5", { size: 20 })),
        BRL: parse(Address, padHex("0xb1", { size: 20 })),
      });
      await expect(settlements.getSettlement("ARS")).resolves.toBe(parse(Address, padHex("0xa5", { size: 20 })));
      await expect(settlements.getSettlement("BRL")).resolves.toBe(parse(Address, padHex("0xb1", { size: 20 })));
      await expect(settlements.getSettlement("USD")).rejects.toThrow(ErrorCodes.NOT_SUPPORTED_CURRENCY);
      expect(fetchSpy).toHaveBeenCalledOnce();
      expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://manteca.test/crypto/v2/company");
    });

    it("skips an entity without evm settlement and retries the company after a failure", async () => {
      const settlements = createManteca("manteca", "https://manteca.test");
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(mockFetchError(500, "internal"))
        .mockResolvedValueOnce(
          mockFetchResponse({
            banking: {
              addresses: [{ legalEntity: "CRYPTO_GLOBAL", address: padHex("0xb1", { size: 20 }), type: "SETTLEMENT" }],
            },
          }),
        );

      await expect(settlements.getSettlements()).rejects.toThrow(ServiceError);
      await expect(settlements.getSettlements()).resolves.toStrictEqual({
        BRL: parse(Address, padHex("0xb1", { size: 20 })),
      });
      await expect(settlements.getSettlement("ARS")).rejects.toThrow(ErrorCodes.NOT_SUPPORTED_CURRENCY);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("uploadIdentityFile", () => {
    it("retries file upload on failure and succeeds", async () => {
      let forwardAttempt = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("upload-identity-image")) {
          return Promise.resolve(mockFetchResponse({ url: "https://presigned.url/upload" }));
        }
        if (url === "https://example.com/document.jpg") {
          return Promise.resolve({
            ok: true,
            status: 200,
            body: new ReadableStream(),
            headers: new Headers({ "content-type": "image/jpeg", "content-length": "1000" }),
          } as Response);
        }
        if (url === "https://presigned.url/upload") {
          forwardAttempt++;
          if (forwardAttempt < 2) {
            return Promise.resolve({
              ok: false,
              status: 500,
              statusText: "Internal Server Error",
              text: () => Promise.resolve("server error"),
            } as Response);
          }
          return Promise.resolve({ ok: true, status: 200 } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") } as Response);
      });

      await manteca.uploadIdentityFile("user-123", "FRONT", "document.jpg", "https://example.com/document.jpg");

      expect(forwardAttempt).toBe(2);
    });

    it("throws after max retries exceeded", async () => {
      let forwardAttempt = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("upload-identity-image")) {
          return Promise.resolve(mockFetchResponse({ url: "https://presigned.url/upload" }));
        }
        if (url === "https://example.com/document.jpg") {
          return Promise.resolve({
            ok: true,
            status: 200,
            body: new ReadableStream(),
            headers: new Headers({ "content-type": "image/jpeg" }),
          } as Response);
        }
        if (url === "https://presigned.url/upload") {
          forwardAttempt++;
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: "Internal Server Error",
            text: () => Promise.resolve("server error"),
          } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") } as Response);
      });

      await expect(
        manteca.uploadIdentityFile("user-123", "FRONT", "document.jpg", "https://example.com/document.jpg"),
      ).rejects.toThrow("Destination upload failed");

      expect(forwardAttempt).toBe(3);
    });

    it("retries when fetch throws an error", async () => {
      let forwardAttempt = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("upload-identity-image")) {
          return Promise.resolve(mockFetchResponse({ url: "https://presigned.url/upload" }));
        }
        if (url === "https://example.com/document.jpg") {
          return Promise.resolve({
            ok: true,
            status: 200,
            body: new ReadableStream(),
            headers: new Headers({ "content-type": "image/jpeg" }),
          } as Response);
        }
        if (url === "https://presigned.url/upload") {
          forwardAttempt++;
          if (forwardAttempt < 2) return Promise.reject(new Error("fetch error"));
          return Promise.resolve({ ok: true, status: 200 } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") } as Response);
      });

      await manteca.uploadIdentityFile("user-123", "FRONT", "document.jpg", "https://example.com/document.jpg");

      expect(forwardAttempt).toBe(2);
    });

    it("retries when presigned URL request fails", async () => {
      let presignedAttempt = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes("upload-identity-image")) {
          presignedAttempt++;
          if (presignedAttempt < 2) {
            return Promise.resolve({
              ok: false,
              status: 500,
              statusText: "Internal Server Error",
              text: () => Promise.resolve("presigned url error"),
            } as Response);
          }
          return Promise.resolve(mockFetchResponse({ url: "https://presigned.url/upload" }));
        }
        if (url === "https://example.com/document.jpg") {
          return Promise.resolve({
            ok: true,
            status: 200,
            body: new ReadableStream(),
            headers: new Headers({ "content-type": "image/jpeg" }),
          } as Response);
        }
        if (url === "https://presigned.url/upload") {
          return Promise.resolve({ ok: true, status: 200 } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("") } as Response);
      });

      await manteca.uploadIdentityFile("user-123", "FRONT", "document.jpg", "https://example.com/document.jpg");

      expect(presignedAttempt).toBe(2);
    });
  });
});

const mockUserBase = {
  id: "123",
  numberId: "456",
  type: "INDIVIDUAL" as const,
  exchange: "ARGENTINA" as const,
  onboarding: {},
  creationTime: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const mockActiveUser = { ...mockUserBase, status: "ACTIVE" as const };
const mockInactiveUser = { ...mockUserBase, status: "INACTIVE" as const };
const mockOnboardingUser = { ...mockUserBase, status: "ONBOARDING" as const };
const mockNewUserResponse = { user: mockOnboardingUser };

const mockBalanceBase = {
  userId: "123",
  userNumberId: "456",
  updatedAt: "2024-01-01T00:00:00Z",
};

const mockOrderResponse = { id: "order-123", numberId: "789", status: "PENDING" as const };
const mockWithdrawResponse = { id: "withdraw-123", numberId: "789", status: "PENDING" as const };

const mockLimitsResponse = [
  {
    exchangeCountry: "ARGENTINA",
    asset: "USD",
    type: "EXCHANGE" as const,
    yearlyLimit: "100000.00",
    availableYearlyLimit: "95000.00",
    monthlyLimit: "10000.00",
    availableMonthlyLimit: "8000.00",
  },
];
