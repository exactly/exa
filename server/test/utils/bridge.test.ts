// cspell:ignore cust midmarket sepa spei iban COBADEFFXXX
import "../mocks/sentry";

import { captureException } from "@sentry/core";
import { parse } from "valibot";
import { hexToBytes, padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { baseSepolia, optimism } from "viem/chains";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { Address } from "@exactly/common/validation";

import database, { credentials } from "../../database";
import * as persona from "../../utils/persona";
import * as bridge from "../../utils/ramps/bridge";

const chainMock = vi.hoisted(() => ({ id: 10 }));

vi.mock("@exactly/common/generated/chain", () => ({
  default: chainMock,
}));

vi.mock("@sentry/core", { spy: true });

describe("bridge utils", () => {
  const owner = privateKeyToAddress(padHex("0xb1d"));
  const factory = inject("ExaAccountFactory");

  beforeAll(async () => {
    await database.insert(credentials).values({
      id: "cred-1",
      publicKey: new Uint8Array(hexToBytes(owner)),
      account: deriveAddress(factory, { x: padHex(owner), y: zeroHash }),
      factory,
    });
  });

  beforeEach(() => {
    chainMock.id = optimism.id;
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      text: () => Promise.resolve(""),
    } as Response);
  });

  afterEach(() => vi.restoreAllMocks());

  describe("getCustomer", () => {
    it("returns customer when found", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchResponse(activeCustomer));

      const result = await bridge.getCustomer("cust-123");

      expect(result).toStrictEqual(activeCustomer);
    });

    it("returns undefined when not found", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchError(404, "not_found"));

      const result = await bridge.getCustomer("cust-missing");

      expect(result).toBeUndefined();
    });

    it("throws on other errors", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchError(500, "internal error"));

      await expect(bridge.getCustomer("cust-123")).rejects.toThrow("internal error");
    });
  });

  describe("getQuote", () => {
    it("returns transformed quote", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchResponse({ midmarket_rate: "1.00", buy_rate: "0.99", sell_rate: "1.01" }),
      );

      const result = await bridge.getQuote("USD", "USD");

      expect(result).toStrictEqual({ buyRate: "0.99", sellRate: "1.01" });
    });

    it("returns undefined on error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchError(500, "error"));

      const result = await bridge.getQuote("USD", "USD");

      expect(result).toBeUndefined();
      expect(captureException).toHaveBeenCalled();
    });
  });

  describe("createCustomer", () => {
    it("returns new customer", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchResponse({ id: "cust-new", status: "not_started" }));

      const result = await bridge.createCustomer(createCustomerPayload);

      expect(result).toStrictEqual({ id: "cust-new", status: "not_started" });
    });

    it("throws EMAIL_ALREADY_EXISTS when email is taken", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchError(409, "A customer with this email already exists"));

      await expect(bridge.createCustomer(createCustomerPayload)).rejects.toThrow(
        bridge.ErrorCodes.EMAIL_ALREADY_EXISTS,
      );
      expect(captureException).toHaveBeenLastCalledWith(expect.objectContaining({ message: "email already exists" }), {
        level: "error",
      });
    });

    it("throws INVALID_ADDRESS when residential_address is invalid", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchError(400, "invalid_parameters: residential_address is not valid"),
      );

      await expect(bridge.createCustomer(createCustomerPayload)).rejects.toThrow(bridge.ErrorCodes.INVALID_ADDRESS);
      expect(captureException).toHaveBeenLastCalledWith(expect.objectContaining({ message: "invalid address" }), {
        level: "warning",
      });
    });

    it("throws on other errors", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchError(400, "bad request"));

      await expect(bridge.createCustomer(createCustomerPayload)).rejects.toThrow("bad request");
    });
  });

  describe("getProvider", () => {
    it("returns NOT_AVAILABLE for unsupported chain id", async () => {
      chainMock.id = 1;

      const result = await bridge.getProvider({ credentialId: "cred-1" });

      expect(result.status).toBe("NOT_AVAILABLE");
      expect(result.onramp.currencies).toStrictEqual([]);
      expect(result.onramp.cryptoCurrencies).toStrictEqual([]);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "bridge not supported chain id" }),
        expect.objectContaining({ level: "error" }),
      );
    });

    describe("with existing customer", () => {
      it("throws when customer not found", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchError(404, "not_found"));

        await expect(bridge.getProvider({ credentialId: "cred-1", customerId: "cust-bad" })).rejects.toThrow(
          bridge.ErrorCodes.BAD_BRIDGE_ID,
        );
      });

      it("returns NOT_AVAILABLE when customer is offboarded", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchResponse({ ...activeCustomer, status: "offboarded" }));

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("NOT_AVAILABLE");
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "bridge user not available" }),
          expect.objectContaining({ level: "warning" }),
        );
      });

      it("returns NOT_AVAILABLE when customer is rejected", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchResponse({ ...activeCustomer, status: "rejected" }));

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("NOT_AVAILABLE");
      });

      it("returns NOT_AVAILABLE when customer is paused", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchResponse({ ...activeCustomer, status: "paused" }));

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("NOT_AVAILABLE");
      });

      it("returns ONBOARDING when customer is under_review", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
          fetchResponse({ ...activeCustomer, status: "under_review" }),
        );

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("ONBOARDING");
        expect(result.onramp.currencies).toStrictEqual(["USD", "EUR"]);
        expect(result.onramp.cryptoCurrencies).toHaveLength(3);
      });

      it("returns ONBOARDING when customer is incomplete", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchResponse({ ...activeCustomer, status: "incomplete" }));

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("ONBOARDING");
      });

      it("returns ACTIVE with GBP from faster_payments endorsement", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
          fetchResponse({
            ...activeCustomer,
            endorsements: [endorsement("base", "approved"), endorsement("faster_payments", "approved")],
          }),
        );

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("ACTIVE");
        expect(result.onramp.currencies).toStrictEqual(["USD", "GBP"]);
      });

      it("returns ACTIVE with currencies from approved endorsements", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
          fetchResponse({
            ...activeCustomer,
            endorsements: [endorsement("base", "approved"), endorsement("sepa", "approved")],
          }),
        );

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("ACTIVE");
        expect(result.onramp.currencies).toStrictEqual(["USD", "EUR"]);
        expect(result.onramp.cryptoCurrencies).toStrictEqual([
          { cryptoCurrency: "USDC", network: "SOLANA" },
          { cryptoCurrency: "USDC", network: "STELLAR" },
          { cryptoCurrency: "USDT", network: "TRON" },
        ]);
      });

      it("stops collecting currencies on first non-approved endorsement", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
          fetchResponse({
            ...activeCustomer,
            endorsements: [endorsement("base", "approved"), endorsement("sepa", "incomplete")],
          }),
        );

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("ACTIVE");
        expect(result.onramp.currencies).toStrictEqual(["USD"]);
        expect(result.onramp.cryptoCurrencies).toStrictEqual([
          { cryptoCurrency: "USDC", network: "SOLANA" },
          { cryptoCurrency: "USDC", network: "STELLAR" },
          { cryptoCurrency: "USDT", network: "TRON" },
        ]);
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "endorsement not approved" }),
          expect.objectContaining({ level: "warning" }),
        );
      });

      it("captures exception for future requirements due", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
          fetchResponse({
            ...activeCustomer,
            future_requirements_due: ["id_verification"],
          }),
        );

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("ACTIVE");
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "bridge future requirements due" }),
          expect.objectContaining({ level: "warning" }),
        );
      });

      it("captures exception for requirements due", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
          fetchResponse({
            ...activeCustomer,
            requirements_due: ["id_verification"],
          }),
        );

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("ACTIVE");
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "bridge requirements due" }),
          expect.objectContaining({ level: "warning" }),
        );
      });

      it("captures exception for additional requirements on endorsement", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
          fetchResponse({
            ...activeCustomer,
            endorsements: [{ ...endorsement("base", "approved"), additional_requirements: ["tos_acceptance"] }],
          }),
        );

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("ACTIVE");
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "additional requirements" }),
          expect.objectContaining({ level: "warning" }),
        );
      });

      it("captures exception for missing requirements on endorsement", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
          fetchResponse({
            ...activeCustomer,
            endorsements: [
              {
                ...endorsement("base", "approved"),
                requirements: { complete: [], pending: [], missing: true, issues: [] },
              },
            ],
          }),
        );

        const result = await bridge.getProvider({ credentialId: "cred-1", customerId: "cust-1" });

        expect(result.status).toBe("ACTIVE");
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "requirements missing" }),
          expect.objectContaining({ level: "warning" }),
        );
      });
    });

    describe("without existing customer", () => {
      it("throws when persona account not found", async () => {
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        await expect(bridge.getProvider({ credentialId: "cred-1" })).rejects.toThrow(
          bridge.ErrorCodes.NO_PERSONA_ACCOUNT,
        );
      });

      it("throws when no valid document found", async () => {
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(personaAccount);
        vi.spyOn(persona, "getDocumentForBridge").mockReturnValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        await expect(bridge.getProvider({ credentialId: "cred-1" })).rejects.toThrow(bridge.ErrorCodes.NO_DOCUMENT);
      });

      it("returns NOT_AVAILABLE when id class is not mappable to bridge type", async () => {
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(personaAccount);
        vi.spyOn(persona, "getDocumentForBridge").mockReturnValueOnce({
          ...identityDocument,
          id_class: { value: "wp" },
        });

        const result = await bridge.getProvider({ credentialId: "cred-1" });

        expect(result).toStrictEqual({ onramp: { currencies: [], cryptoCurrencies: [] }, status: "NOT_AVAILABLE" });
        expect(captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: "bridge not found identification class" }),
          { contexts: { bridge: { credentialId: "cred-1", idClass: "wp" } }, level: "warning" },
        );
      });

      it("throws when country alpha3 conversion fails", async () => {
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
          ...personaAccount,
          attributes: { ...personaAccount.attributes, "country-code": "INVALID" },
        });

        await expect(bridge.getProvider({ credentialId: "cred-1" })).rejects.toThrow(
          bridge.ErrorCodes.NO_COUNTRY_ALPHA3,
        );
      });

      it("throws when US user has no SSN", async () => {
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
          ...personaAccount,
          attributes: { ...personaAccount.attributes, "country-code": "US", "social-security-number": null },
        });

        await expect(bridge.getProvider({ credentialId: "cred-1" })).rejects.toThrow(
          bridge.ErrorCodes.NO_SOCIAL_SECURITY_NUMBER,
        );
      });

      it("returns NOT_STARTED with basic currencies for standard country", async () => {
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(personaAccount);
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchResponse({ url: "https://tos.link" }));

        const result = await bridge.getProvider({ credentialId: "cred-1" });

        expect(result.status).toBe("NOT_STARTED");
        expect(result.onramp.currencies).toStrictEqual(["USD", "EUR"]);
        expect(result.onramp.cryptoCurrencies).toStrictEqual([
          { cryptoCurrency: "USDC", network: "SOLANA" },
          { cryptoCurrency: "USDC", network: "STELLAR" },
          { cryptoCurrency: "USDT", network: "TRON" },
        ]);
      });

      it("appends spei endorsement for MX country", async () => {
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
          ...personaAccount,
          attributes: { ...personaAccount.attributes, "country-code": "MX" },
        });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchResponse({ url: "https://tos.link" }));

        const result = await bridge.getProvider({ credentialId: "cred-1" });

        expect(persona.getAccount).toHaveBeenCalledWith("cred-1", "bridge");
        expect(result.onramp.currencies).toStrictEqual(["USD", "EUR", "MXN"]);
        expect(result.onramp.cryptoCurrencies).toStrictEqual([
          { cryptoCurrency: "USDC", network: "SOLANA" },
          { cryptoCurrency: "USDC", network: "STELLAR" },
          { cryptoCurrency: "USDT", network: "TRON" },
        ]);
      });

      it("appends pix endorsement for BR country", async () => {
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
          ...personaAccount,
          attributes: { ...personaAccount.attributes, "country-code": "BR" },
        });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchResponse({ url: "https://tos.link" }));

        const result = await bridge.getProvider({ credentialId: "cred-1" });

        expect(persona.getAccount).toHaveBeenCalledWith("cred-1", "bridge");
        expect(result.onramp.currencies).toStrictEqual(["USD", "EUR", "BRL"]);
        expect(result.onramp.cryptoCurrencies).toStrictEqual([
          { cryptoCurrency: "USDC", network: "SOLANA" },
          { cryptoCurrency: "USDC", network: "STELLAR" },
          { cryptoCurrency: "USDT", network: "TRON" },
        ]);
      });

      it("appends faster_payments endorsement for GB country", async () => {
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
          ...personaAccount,
          attributes: { ...personaAccount.attributes, "country-code": "GB" },
        });
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchResponse({ url: "https://tos.link" }));

        const result = await bridge.getProvider({ credentialId: "cred-1" });

        expect(persona.getAccount).toHaveBeenCalledWith("cred-1", "bridge");
        expect(result.onramp.currencies).toStrictEqual(["USD", "EUR", "GBP"]);
        expect(result.onramp.cryptoCurrencies).toStrictEqual([
          { cryptoCurrency: "USDC", network: "SOLANA" },
          { cryptoCurrency: "USDC", network: "STELLAR" },
          { cryptoCurrency: "USDT", network: "TRON" },
        ]);
      });

      it("appends redirect URL with provider param", async () => {
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(personaAccount);
        const fetchSpy = vi
          .spyOn(globalThis, "fetch")
          .mockResolvedValueOnce(fetchResponse({ url: "https://tos.link" }));

        await bridge.getProvider({ credentialId: "cred-1", redirectURL: "https://app.example.com/callback" });

        const tosCall = fetchSpy.mock.calls[0];
        const url = tosCall?.[0] as string;
        expect(url).toContain("/customers/tos_links");
      });

      it("works on development chain", async () => {
        chainMock.id = baseSepolia.id;
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(personaAccount);
        vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(fetchResponse({ url: "https://tos.link" }));

        const result = await bridge.getProvider({ credentialId: "cred-1" });

        expect(result.status).toBe("NOT_STARTED");
      });
    });
  });

  describe("onboarding", () => {
    it("throws ALREADY_ONBOARDED when customerId exists", async () => {
      await expect(
        bridge.onboarding({ credentialId: "cred-1", customerId: "cust-1", acceptedTermsId: "terms-1" }),
      ).rejects.toThrow(bridge.ErrorCodes.ALREADY_ONBOARDED);
    });

    it("throws NOT_SUPPORTED_CHAIN_ID for unsupported chain", async () => {
      chainMock.id = 1;

      await expect(
        bridge.onboarding({ credentialId: "cred-1", customerId: null, acceptedTermsId: "terms-1" }),
      ).rejects.toThrow(bridge.ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "bridge not supported chain id" }),
        expect.objectContaining({ level: "error" }),
      );
    });

    it("throws when persona account not found", async () => {
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

      await expect(
        bridge.onboarding({ credentialId: "cred-1", customerId: null, acceptedTermsId: "terms-1" }),
      ).rejects.toThrow(bridge.ErrorCodes.NO_PERSONA_ACCOUNT);
    });

    it("throws when no valid document found", async () => {
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce(personaAccount);
      vi.spyOn(persona, "getDocumentForBridge").mockReturnValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

      await expect(
        bridge.onboarding({ credentialId: "cred-1", customerId: null, acceptedTermsId: "terms-1" }),
      ).rejects.toThrow(bridge.ErrorCodes.NO_DOCUMENT);
    });

    it("throws when front document photo is missing", async () => {
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce(personaAccount);
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce({
        ...documentResponse,
        attributes: { ...documentResponse.attributes, "front-photo": null },
      });

      await expect(
        bridge.onboarding({ credentialId: "cred-1", customerId: null, acceptedTermsId: "terms-1" }),
      ).rejects.toThrow(bridge.ErrorCodes.NO_DOCUMENT_FILE);
    });

    it("throws when id class is not mappable to bridge type", async () => {
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
        ...personaAccount,
        attributes: {
          ...personaAccount.attributes,
          fields: {
            ...personaAccount.attributes.fields,
            documents: { value: [{ value: { ...identityDocument, id_class: { value: "wp" } } }] },
          },
        },
      });
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce(documentResponse);
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(blobResponse()).mockResolvedValueOnce(blobResponse());

      await expect(
        bridge.onboarding({ credentialId: "cred-1", customerId: null, acceptedTermsId: "terms-1" }),
      ).rejects.toThrow(bridge.ErrorCodes.NOT_FOUND_IDENTIFICATION_CLASS);
    });

    it("throws when country alpha3 conversion fails", async () => {
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
        ...personaAccount,
        attributes: { ...personaAccount.attributes, "country-code": "INVALID" },
      });
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce(documentResponse);
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(blobResponse()).mockResolvedValueOnce(blobResponse());

      await expect(
        bridge.onboarding({ credentialId: "cred-1", customerId: null, acceptedTermsId: "terms-1" }),
      ).rejects.toThrow(bridge.ErrorCodes.NO_COUNTRY_ALPHA3);
    });

    it("throws when US user has no SSN", async () => {
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
        ...personaAccount,
        attributes: { ...personaAccount.attributes, "country-code": "US", "social-security-number": null },
      });
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce(documentResponse);
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(blobResponse()).mockResolvedValueOnce(blobResponse());

      await expect(
        bridge.onboarding({ credentialId: "cred-1", customerId: null, acceptedTermsId: "terms-1" }),
      ).rejects.toThrow(bridge.ErrorCodes.NO_SOCIAL_SECURITY_NUMBER);
    });

    it("includes ssn for US country", async () => {
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
        ...personaAccount,
        attributes: {
          ...personaAccount.attributes,
          "country-code": "US",
          "social-security-number": "123456789",
        },
      });
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce(documentResponse);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(["front"])) } as Response)
        .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(["back"])) } as Response)
        .mockResolvedValueOnce(fetchResponse({ id: "cust-new", status: "not_started" }));

      await bridge.onboarding({ credentialId: "cred-1", customerId: null, acceptedTermsId: "terms-1" });

      const createCall = fetchSpy.mock.calls[2];
      const body = JSON.parse(createCall?.[1]?.body as string) as {
        identifying_information: { issuing_country: string; number: string; type: string }[];
      };
      expect(body.identifying_information).toContainEqual({ type: "ssn", number: "123456789", issuing_country: "USA" });
    });

    it("includes spei endorsement for MX country", async () => {
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
        ...personaAccount,
        attributes: { ...personaAccount.attributes, "country-code": "MX" },
      });
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce(documentResponse);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(["front"])) } as Response)
        .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(["back"])) } as Response)
        .mockResolvedValueOnce(fetchResponse({ id: "cust-new", status: "not_started" }));

      await bridge.onboarding({ credentialId: "cred-1", customerId: null, acceptedTermsId: "terms-1" });

      const createCall = fetchSpy.mock.calls[2];
      const body = JSON.parse(createCall?.[1]?.body as string) as { endorsements: string[] };
      expect(body.endorsements).toContain("spei");
    });

    it("includes faster_payments endorsement for GB country", async () => {
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
        ...personaAccount,
        attributes: { ...personaAccount.attributes, "country-code": "GB" },
      });
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce(documentResponse);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(["front"])) } as Response)
        .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(["back"])) } as Response)
        .mockResolvedValueOnce(fetchResponse({ id: "cust-new", status: "not_started" }));

      await bridge.onboarding({ credentialId: "cred-1", customerId: null, acceptedTermsId: "terms-1" });

      const createCall = fetchSpy.mock.calls[2];
      const body = JSON.parse(createCall?.[1]?.body as string) as { endorsements: string[] };
      expect(body.endorsements).toContain("faster_payments");
    });

    it("includes pix endorsement for BR country", async () => {
      vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
        ...personaAccount,
        attributes: { ...personaAccount.attributes, "country-code": "BR" },
      });
      vi.spyOn(persona, "getDocument").mockResolvedValueOnce(documentResponse);
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(["front"])) } as Response)
        .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(["back"])) } as Response)
        .mockResolvedValueOnce(fetchResponse({ id: "cust-new", status: "not_started" }));

      await bridge.onboarding({ credentialId: "cred-1", customerId: null, acceptedTermsId: "terms-1" });

      const createCall = fetchSpy.mock.calls[2];
      const body = JSON.parse(createCall?.[1]?.body as string) as { endorsements: string[] };
      expect(body.endorsements).toContain("pix");
    });
  });

  describe("getDepositDetails", () => {
    const account = parse(Address, padHex("0x1", { size: 20 }));

    it("throws NOT_SUPPORTED_CHAIN_ID for unsupported chain", async () => {
      chainMock.id = 1;

      await expect(bridge.getDepositDetails("USD", account, activeCustomer)).rejects.toThrow(
        bridge.ErrorCodes.NOT_SUPPORTED_CHAIN_ID,
      );
    });

    it("throws NOT_ACTIVE_CUSTOMER when customer is not active", async () => {
      await expect(
        bridge.getDepositDetails("USD", account, { ...activeCustomer, status: "under_review" }),
      ).rejects.toThrow(bridge.ErrorCodes.NOT_ACTIVE_CUSTOMER);
    });

    it("throws NOT_AVAILABLE_CURRENCY when currency is not endorsed", async () => {
      await expect(bridge.getDepositDetails("EUR", account, activeCustomer)).rejects.toThrow(
        bridge.ErrorCodes.NOT_AVAILABLE_CURRENCY,
      );
    });

    it("returns USD deposit details from existing virtual account", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchResponse({ count: 1, data: [usdVirtualAccount(account)] }),
      );

      const result = await bridge.getDepositDetails("USD", account, activeCustomerWithBaseEndorsement);

      expect(result).toHaveLength(2);
      expect(result[0]).toStrictEqual({
        network: "ACH",
        displayName: "ACH",
        beneficiaryName: "Test Beneficiary",
        routingNumber: "111000025",
        accountNumber: "000123456789",
        bankAddress: "123 Bank St",
        bankName: "Test Bank",
        fee: "0.0",
        estimatedProcessingTime: "1 - 3 business days",
      });
      expect(result[1]).toStrictEqual({
        network: "WIRE",
        displayName: "WIRE",
        beneficiaryName: "Test Beneficiary",
        routingNumber: "111000025",
        accountNumber: "000123456789",
        bankAddress: "123 Bank St",
        bankName: "Test Bank",
        fee: "0.0",
        estimatedProcessingTime: "300",
      });
    });

    it("creates virtual account when none exists", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(fetchResponse({ count: 0, data: [] }))
        .mockResolvedValueOnce(fetchResponse(usdVirtualAccount(account)));

      const result = await bridge.getDepositDetails("USD", account, activeCustomerWithBaseEndorsement);

      expect(result).toHaveLength(2);
    });

    it("returns EUR deposit details with SEPA info", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchResponse({ count: 1, data: [eurVirtualAccount(account)] }),
      );

      const result = await bridge.getDepositDetails("EUR", account, activeCustomerWithSepaEndorsement);

      expect(result).toHaveLength(1);
      expect(result[0]).toStrictEqual({
        network: "SEPA",
        displayName: "SEPA",
        beneficiaryName: "Test Holder",
        iban: "DE89370400440532013000",
        fee: "0.0",
        estimatedProcessingTime: "300",
      });
    });

    it("returns MXN deposit details with SPEI info", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchResponse({ count: 1, data: [mxnVirtualAccount(account)] }),
      );

      const customer = {
        ...activeCustomer,
        endorsements: [endorsement("base", "approved"), endorsement("spei", "approved")],
      };

      const result = await bridge.getDepositDetails("MXN", account, customer);

      expect(result).toHaveLength(1);
      expect(result[0]).toStrictEqual({
        network: "SPEI",
        displayName: "SPEI",
        beneficiaryName: "Test Holder MX",
        clabe: "646180171800000178", // cspell:ignore clabe
        fee: "0.0",
        estimatedProcessingTime: "300",
      });
    });

    it("returns GBP deposit details with Faster Payments info", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchResponse({ count: 1, data: [gbpVirtualAccount(account)] }),
      );

      const result = await bridge.getDepositDetails("GBP", account, activeCustomerWithFasterPaymentsEndorsement);

      expect(result).toHaveLength(1);
      expect(result[0]).toStrictEqual({
        network: "FASTER_PAYMENTS",
        displayName: "Faster Payments",
        accountNumber: "12345678",
        sortCode: "123456",
        accountHolderName: "Test Holder GB",
        bankName: "UK Bank",
        bankAddress: "10 Downing St",
        fee: "0.0",
        estimatedProcessingTime: "300",
      });
    });

    it("throws INVALID_ACCOUNT when virtual account destination does not match", async () => {
      const wrongAccount = parse(Address, padHex("0x999", { size: 20 }));
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchResponse({ count: 1, data: [usdVirtualAccount(wrongAccount)] }),
      );

      await expect(bridge.getDepositDetails("USD", account, activeCustomerWithBaseEndorsement)).rejects.toThrow(
        bridge.ErrorCodes.INVALID_ACCOUNT,
      );
    });
  });

  describe("getVirtualAccounts", () => {
    it("paginates when count exceeds first page", async () => {
      const page1 = Array.from({ length: 20 }, (_, index) => ({
        ...usdVirtualAccount(`0x${String(index).padStart(40, "0")}`),
        id: `va-${String(index)}`,
      }));
      const page2 = [{ ...usdVirtualAccount("0x20"), id: "va-20" }];
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(fetchResponse({ count: 21, data: page1 }))
        .mockResolvedValueOnce(fetchResponse({ count: 21, data: page2 }));

      const result = await bridge.getVirtualAccounts("cust-1");

      expect(result).toHaveLength(21);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "bridge virtual accounts pagination" }),
        expect.objectContaining({ level: "warning" }),
      );
    });

    it("does not paginate when all results fit in first page", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(fetchResponse({ count: 1, data: [usdVirtualAccount("0x1")] }));

      const result = await bridge.getVirtualAccounts("cust-1");

      expect(result).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
  });

  describe("getLiquidationAddresses", () => {
    it("paginates when count exceeds first page", async () => {
      const page1 = Array.from({ length: 20 }, (_, index) => ({
        id: `la-${String(index)}`,
        currency: "usdt" as const,
        chain: "tron" as const,
        address: `TAddr${String(index)}`,
        destination_address: `0x${String(index).padStart(40, "0")}`,
      }));
      const page2 = [
        {
          id: "la-20",
          currency: "usdt" as const,
          chain: "tron" as const,
          address: "TAddr20",
          destination_address: "0x20",
        },
      ];
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(fetchResponse({ count: 21, data: page1 }))
        .mockResolvedValueOnce(fetchResponse({ count: 21, data: page2 }));

      const result = await bridge.getLiquidationAddresses("cust-1");

      expect(result).toHaveLength(21);
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "bridge liquidation addresses pagination" }),
        expect.objectContaining({ level: "warning" }),
      );
    });

    it("does not paginate when all results fit in first page", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchResponse({
          count: 1,
          data: [{ id: "la-1", currency: "usdt", chain: "tron", address: "TAddr1", destination_address: "0x1" }],
        }),
      );

      const result = await bridge.getLiquidationAddresses("cust-1");

      expect(result).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledOnce();
    });
  });

  describe("getCryptoDepositDetails", () => {
    const account = parse(Address, padHex("0x1", { size: 20 }));

    it("throws NOT_SUPPORTED_CHAIN_ID for unsupported chain", async () => {
      chainMock.id = 1;

      await expect(bridge.getCryptoDepositDetails("USDT", "TRON", account, activeCustomer)).rejects.toThrow(
        bridge.ErrorCodes.NOT_SUPPORTED_CHAIN_ID,
      );
    });

    it("throws NOT_ACTIVE_CUSTOMER when customer is not active", async () => {
      await expect(
        bridge.getCryptoDepositDetails("USDT", "TRON", account, { ...activeCustomer, status: "rejected" }),
      ).rejects.toThrow(bridge.ErrorCodes.NOT_ACTIVE_CUSTOMER);
    });

    it("throws NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL for invalid combination", async () => {
      await expect(bridge.getCryptoDepositDetails("USDC", "TRON", account, activeCustomer)).rejects.toThrow(
        bridge.ErrorCodes.NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL,
      );
    });

    it("returns TRON deposit details from existing liquidation address", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchResponse({
          count: 1,
          data: [{ id: "la-1", currency: "usdt", chain: "tron", address: "TAddr123", destination_address: account }],
        }),
      );

      const result = await bridge.getCryptoDepositDetails("USDT", "TRON", account, activeCustomer);

      expect(result).toHaveLength(1);
      expect(result[0]).toStrictEqual({
        network: "TRON",
        displayName: "TRON",
        address: "TAddr123",
        fee: "0.0",
        estimatedProcessingTime: "300",
      });
    });

    it("returns SOLANA deposit details", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchResponse({
          count: 1,
          data: [
            { id: "la-2", currency: "usdc", chain: "solana", address: "SolAddr456", destination_address: account },
          ],
        }),
      );

      const result = await bridge.getCryptoDepositDetails("USDC", "SOLANA", account, activeCustomer);

      expect(result).toHaveLength(1);
      expect(result[0]).toStrictEqual({
        network: "SOLANA",
        displayName: "SOLANA",
        address: "SolAddr456",
        fee: "0.0",
        estimatedProcessingTime: "300",
      });
    });

    it("returns STELLAR deposit details", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchResponse({
          count: 1,
          data: [
            {
              id: "la-3",
              currency: "usdc",
              chain: "stellar",
              address: "StellarAddr789",
              destination_address: account,
            },
          ],
        }),
      );

      const result = await bridge.getCryptoDepositDetails("USDC", "STELLAR", account, activeCustomer);

      expect(result).toHaveLength(1);
      expect(result[0]).toStrictEqual({
        network: "STELLAR",
        displayName: "STELLAR",
        address: "StellarAddr789",
        fee: "0.0",
        estimatedProcessingTime: "300",
      });
    });

    it("creates liquidation address when none exists", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(fetchResponse({ count: 0, data: [] }))
        .mockResolvedValueOnce(
          fetchResponse({
            id: "la-new",
            currency: "usdt",
            chain: "tron",
            address: "TNewAddr",
            destination_address: account,
          }),
        );

      const result = await bridge.getCryptoDepositDetails("USDT", "TRON", account, activeCustomer);

      expect(result).toHaveLength(1);
      expect(result[0]).toStrictEqual(expect.objectContaining({ address: "TNewAddr" }));
    });

    it("throws INVALID_ACCOUNT when liquidation address destination does not match", async () => {
      const wrongAccount = parse(Address, padHex("0x999", { size: 20 }));
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        fetchResponse({
          count: 1,
          data: [
            { id: "la-1", currency: "usdt", chain: "tron", address: "TAddr123", destination_address: wrongAccount },
          ],
        }),
      );

      await expect(bridge.getCryptoDepositDetails("USDT", "TRON", account, activeCustomer)).rejects.toThrow(
        bridge.ErrorCodes.INVALID_ACCOUNT,
      );
    });
  });
});

const identityDocument = {
  id_class: { value: "pp" },
  id_number: { value: "AB123456" },
  id_issuing_country: { value: "AR" },
  id_document_id: { value: "doc-123" },
};

const documentResponse = {
  id: "doc-123",
  attributes: {
    "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
    "back-photo": { filename: "back.jpg", url: "https://example.com/back.jpg" },
    "selfie-photo": null,
    "id-class": "pp",
  },
};

const personaAccount = {
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
      documents: { value: [{ value: identityDocument }] },
    },
  },
};

function endorsement(
  name: "base" | "faster_payments" | "pix" | "sepa" | "spei",
  status: "approved" | "incomplete" | "revoked",
) {
  return { name, status, requirements: { complete: [], pending: [], missing: null, issues: [] } };
}

const activeCustomer = {
  id: "cust-123",
  status: "active" as const,
  endorsements: [] as ReturnType<typeof endorsement>[],
};

const activeCustomerWithBaseEndorsement = {
  ...activeCustomer,
  endorsements: [endorsement("base", "approved")],
};

const activeCustomerWithSepaEndorsement = {
  ...activeCustomer,
  endorsements: [endorsement("sepa", "approved")],
};

const activeCustomerWithFasterPaymentsEndorsement = {
  ...activeCustomer,
  endorsements: [endorsement("faster_payments", "approved")],
};

function usdVirtualAccount(account: string) {
  return {
    id: "va-usd",
    status: "activated",
    source_deposit_instructions: {
      currency: "usd",
      payment_rails: ["ach_push", "wire"],
      bank_name: "Test Bank",
      bank_address: "123 Bank St",
      bank_routing_number: "111000025",
      bank_account_number: "000123456789",
      bank_beneficiary_name: "Test Beneficiary",
      bank_beneficiary_address: "456 Beneficiary Ave",
    },
    destination: { address: account },
  };
}

function eurVirtualAccount(account: string) {
  return {
    id: "va-eur",
    status: "activated",
    source_deposit_instructions: {
      currency: "eur",
      payment_rails: ["sepa"],
      bank_name: "EU Bank",
      bank_address: "789 EU St",
      account_holder_name: "Test Holder",
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
    },
    destination: { address: account },
  };
}

function mxnVirtualAccount(account: string) {
  return {
    id: "va-mxn",
    status: "activated",
    source_deposit_instructions: {
      currency: "mxn",
      payment_rails: ["spei"],
      account_holder_name: "Test Holder MX",
      clabe: "646180171800000178", // cspell:ignore clabe
    },
    destination: { address: account },
  };
}

function gbpVirtualAccount(account: string) {
  return {
    id: "va-gbp",
    status: "activated",
    source_deposit_instructions: {
      currency: "gbp",
      payment_rails: ["faster_payments"],
      account_number: "12345678",
      sort_code: "123456",
      account_holder_name: "Test Holder GB",
      bank_name: "UK Bank",
      bank_address: "10 Downing St",
    },
    destination: { address: account },
  };
}

function fetchResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(body)).buffer),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function fetchError(status: number, message: string) {
  return {
    ok: false,
    status,
    text: () => Promise.resolve(message),
  } as Response;
}

function blobResponse() {
  return { ok: true, blob: () => Promise.resolve(new Blob(["img"], { type: "image/jpeg" })) } as Response;
}

const createCustomerPayload = {
  type: "individual" as const,
  first_name: "John",
  last_name: "Doe",
  email: "john@example.com",
  phone: "+1234567890",
  residential_address: {
    street_line_1: "123 Main St",
    city: "Buenos Aires",
    country: "ARG",
  },
  birth_date: "1990-01-01",
  signed_agreement_id: "terms-123",
  nationality: "ARG",
  identifying_information: [
    { type: "passport" as const, issuing_country: "AR", number: "AB123456", image_front: "data:image/jpg;base64,abc" },
  ],
};
