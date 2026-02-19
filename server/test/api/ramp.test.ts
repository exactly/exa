import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/sentry";

import { testClient } from "hono/testing";
import { hexToBytes, padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";

import app from "../../api/ramp";
import database, { credentials } from "../../database";
import * as persona from "../../utils/persona";
import * as bridge from "../../utils/ramps/bridge";
import * as manteca from "../../utils/ramps/manteca";

const appClient = testClient(app);

describe("ramp api", () => {
  const owner = privateKeyToAddress(padHex("0xdef"));
  const factory = inject("ExaAccountFactory");
  const account = deriveAddress(factory, { x: padHex(owner), y: zeroHash });

  beforeAll(async () => {
    await database.insert(credentials).values([
      { id: "ramp-test", publicKey: new Uint8Array(hexToBytes(owner)), account, factory, pandaId: "rampPandaId" },
      {
        id: "ramp-bridge",
        publicKey: new Uint8Array(hexToBytes(owner)),
        account: deriveAddress(factory, { x: padHex(privateKeyToAddress(padHex("0xbee"))), y: zeroHash }),
        factory,
        pandaId: "bridgePandaId",
        bridgeId: "bridge-customer-123",
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe("get", () => {
    it("returns 400 for no credential", async () => {
      const response = await appClient.index.$get({ query: {} }, { headers: { "test-credential-id": "non-existent" } });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "no credential" });
    });

    it("returns providers info", async () => {
      vi.spyOn(manteca, "getProvider").mockResolvedValue({
        onramp: { currencies: ["ARS", "USD"], cryptoCurrencies: [] },
        status: "NOT_STARTED",
      });
      vi.spyOn(bridge, "getProvider").mockResolvedValue({
        onramp: { currencies: [], cryptoCurrencies: [] },
        status: "NOT_AVAILABLE",
      });

      const response = await appClient.index.$get({ query: {} }, { headers: { "test-credential-id": "ramp-test" } });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toStrictEqual({
        manteca: { onramp: { currencies: ["ARS", "USD"], cryptoCurrencies: [] }, status: "NOT_STARTED" },
        bridge: { onramp: { currencies: [], cryptoCurrencies: [] }, status: "NOT_AVAILABLE" },
      });
    });

    it("returns NOT_AVAILABLE when manteca provider fails", async () => {
      vi.spyOn(manteca, "getProvider").mockRejectedValue(new Error("manteca error"));
      vi.spyOn(bridge, "getProvider").mockResolvedValue({
        onramp: { currencies: [], cryptoCurrencies: [] },
        status: "NOT_AVAILABLE",
      });

      const response = await appClient.index.$get({ query: {} }, { headers: { "test-credential-id": "ramp-test" } });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toStrictEqual({
        manteca: { onramp: { currencies: [], cryptoCurrencies: [] }, status: "NOT_AVAILABLE" },
        bridge: { onramp: { currencies: [], cryptoCurrencies: [] }, status: "NOT_AVAILABLE" },
      });
    });

    it("returns NOT_AVAILABLE when bridge provider fails", async () => {
      vi.spyOn(manteca, "getProvider").mockResolvedValue({
        onramp: { currencies: ["ARS"], cryptoCurrencies: [] },
        status: "ACTIVE",
      });
      vi.spyOn(bridge, "getProvider").mockRejectedValue(new Error("bridge error"));

      const response = await appClient.index.$get({ query: {} }, { headers: { "test-credential-id": "ramp-test" } });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toStrictEqual({
        manteca: { onramp: { currencies: ["ARS"], cryptoCurrencies: [] }, status: "ACTIVE" },
        bridge: { onramp: { currencies: [], cryptoCurrencies: [] }, status: "NOT_AVAILABLE" },
      });
    });
  });

  describe("quote", () => {
    describe("manteca provider", () => {
      it("returns 400 if manteca user not started", async () => {
        vi.spyOn(manteca, "getUser").mockResolvedValue(null);

        const response = await appClient.quote.$get(
          { query: { provider: "manteca", currency: "ARS" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
      });

      it("returns quote and deposit info for manteca", async () => {
        vi.spyOn(manteca, "getUser").mockResolvedValue(mantecaUser);
        vi.spyOn(manteca, "getQuote").mockResolvedValue({ buyRate: "1000", sellRate: "1010" });

        const response = await appClient.quote.$get(
          { query: { provider: "manteca", currency: "ARS" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json).toMatchObject({
          quote: { buyRate: "1000", sellRate: "1010" },
          depositInfo: [
            {
              depositAlias: "exa.ars",
              cbu: "0000234100000000000529",
              network: "ARG_FIAT_TRANSFER",
              fee: "0.0",
              estimatedProcessingTime: "300",
              displayName: "CVU",
              beneficiaryName: "Sixalime Sas", // cspell:ignore Sixalime
            } as const,
          ],
        });
      });

      it("returns 400 for unsupported currency", async () => {
        vi.spyOn(manteca, "getUser").mockResolvedValue(mantecaUser);

        const response = await appClient.quote.$get(
          { query: { provider: "manteca", currency: "CLP" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "not supported currency" });
      });
    });

    describe("bridge provider", () => {
      it("returns 400 if bridge user not started", async () => {
        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "USD" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
      });

      it("returns 400 if bridge customer not found", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "USD" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
      });

      it("returns quote and deposit info for bridge fiat", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
        vi.spyOn(bridge, "getDepositDetails").mockResolvedValue([bridgeDepositDetails]);
        vi.spyOn(bridge, "getQuote").mockResolvedValue({ buyRate: "1.00", sellRate: "1.00" });

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "USD" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json).toStrictEqual({
          quote: { buyRate: "1.00", sellRate: "1.00" },
          depositInfo: [
            {
              network: "ACH",
              accountNumber: "123456789",
              routingNumber: "987654321",
              displayName: "ACH",
              beneficiaryName: "Test User",
              bankName: "Test Bank",
              bankAddress: "123 Test St",
              fee: "0",
              estimatedProcessingTime: "86400",
            },
          ],
        });
      });
    });
  });

  describe("onboarding", () => {
    describe("manteca", () => {
      it("onboards manteca successfully", async () => {
        vi.spyOn(manteca, "mantecaOnboarding").mockResolvedValue();

        const response = await appClient.index.$post(
          { json: { provider: "manteca" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
        expect(manteca.mantecaOnboarding).toHaveBeenCalledWith(account, "ramp-test");
      });

      it("returns 400 with new inquiry for invalid legal id when no existing inquiry", async () => {
        vi.spyOn(manteca, "mantecaOnboarding").mockRejectedValue(new Error(manteca.ErrorCodes.INVALID_LEGAL_ID));
        vi.spyOn(persona, "getInquiry").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        vi.spyOn(persona, "createInquiry").mockResolvedValue({
          data: {
            id: "inq_abc123",
            type: "inquiry" as const,
            attributes: { status: "created" as const, "reference-id": "ramp-test" },
          },
        });
        vi.spyOn(persona, "resumeInquiry").mockResolvedValue({
          data: { id: "inq_abc123", type: "inquiry" as const },
          meta: { "session-token": "token_xyz" },
        });

        const response = await appClient.index.$post(
          { json: { provider: "manteca" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "invalid legal id",
          inquiryId: "inq_abc123",
          sessionToken: "token_xyz",
        });
        expect(persona.createInquiry).toHaveBeenCalledTimes(1);
      });

      it("resumes existing inquiry for invalid legal id when inquiry is resumable", async () => {
        vi.spyOn(manteca, "mantecaOnboarding").mockRejectedValue(new Error(manteca.ErrorCodes.INVALID_LEGAL_ID));
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          id: "inq_existing",
          type: "inquiry" as const,
          attributes: { status: "created" as const, "reference-id": "ramp-test" },
        });
        const createInquirySpy = vi.spyOn(persona, "createInquiry");
        vi.spyOn(persona, "resumeInquiry").mockResolvedValue({
          data: { id: "inq_existing", type: "inquiry" as const },
          meta: { "session-token": "token_existing" },
        });

        const response = await appClient.index.$post(
          { json: { provider: "manteca" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "invalid legal id",
          inquiryId: "inq_existing",
          sessionToken: "token_existing",
        });
        expect(createInquirySpy).not.toHaveBeenCalled();
      });

      it("creates new inquiry for invalid legal id when existing inquiry is not resumable", async () => {
        vi.spyOn(manteca, "mantecaOnboarding").mockRejectedValue(new Error(manteca.ErrorCodes.INVALID_LEGAL_ID));
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          id: "inq_approved",
          type: "inquiry" as const,
          attributes: { status: "approved" as const, "reference-id": "ramp-test" },
        });
        vi.spyOn(persona, "createInquiry").mockResolvedValue({
          data: {
            id: "inq_new",
            type: "inquiry" as const,
            attributes: { status: "created" as const, "reference-id": "ramp-test" },
          },
        });
        vi.spyOn(persona, "resumeInquiry").mockResolvedValue({
          data: { id: "inq_new", type: "inquiry" as const },
          meta: { "session-token": "token_new" },
        });

        const response = await appClient.index.$post(
          { json: { provider: "manteca" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "invalid legal id",
          inquiryId: "inq_new",
          sessionToken: "token_new",
        });
        expect(persona.createInquiry).toHaveBeenCalledTimes(1);
      });

      it("returns 400 for no document error", async () => {
        vi.spyOn(manteca, "mantecaOnboarding").mockRejectedValue(new Error(manteca.ErrorCodes.NO_DOCUMENT));

        const response = await appClient.index.$post(
          { json: { provider: "manteca" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "no document" });
      });
    });

    describe("bridge", () => {
      it("onboards bridge successfully", async () => {
        vi.spyOn(bridge, "onboarding").mockResolvedValue();

        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_123" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
        expect(bridge.onboarding).toHaveBeenCalledWith({
          credentialId: "ramp-test",
          customerId: null,
          acceptedTermsId: "terms_123",
        });
      });

      it("passes existing bridgeId as customerId", async () => {
        vi.spyOn(bridge, "onboarding").mockResolvedValue();

        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_456" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
        expect(bridge.onboarding).toHaveBeenCalledWith({
          credentialId: "ramp-bridge",
          customerId: "bridge-customer-123",
          acceptedTermsId: "terms_456",
        });
      });

      it("returns 400 when already onboarded", async () => {
        vi.spyOn(bridge, "onboarding").mockRejectedValue(new Error(bridge.ErrorCodes.ALREADY_ONBOARDED));

        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_123" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "already onboarded" });
      });

      it("returns 400 with new inquiry for invalid address when no existing inquiry", async () => {
        vi.spyOn(bridge, "onboarding").mockRejectedValue(new Error(bridge.ErrorCodes.INVALID_ADDRESS));
        vi.spyOn(persona, "getInquiry").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        vi.spyOn(persona, "createInquiry").mockResolvedValue({
          data: {
            id: "inq_addr_new",
            type: "inquiry" as const,
            attributes: { status: "created" as const, "reference-id": "ramp-test" },
          },
        });
        vi.spyOn(persona, "resumeInquiry").mockResolvedValue({
          data: { id: "inq_addr_new", type: "inquiry" as const },
          meta: { "session-token": "token_addr" },
        });

        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_123" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "invalid address",
          inquiryId: "inq_addr_new",
          sessionToken: "token_addr",
        });
        expect(persona.createInquiry).toHaveBeenCalledTimes(1);
        expect(persona.getInquiry).toHaveBeenCalledWith("ramp-test", persona.ADDRESS_TEMPLATE);
      });

      it("resumes existing inquiry for invalid address when inquiry is resumable", async () => {
        vi.spyOn(bridge, "onboarding").mockRejectedValue(new Error(bridge.ErrorCodes.INVALID_ADDRESS));
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          id: "inq_addr_existing",
          type: "inquiry" as const,
          attributes: { status: "created" as const, "reference-id": "ramp-test" },
        });
        const createInquirySpy = vi.spyOn(persona, "createInquiry");
        vi.spyOn(persona, "resumeInquiry").mockResolvedValue({
          data: { id: "inq_addr_existing", type: "inquiry" as const },
          meta: { "session-token": "token_addr_existing" },
        });

        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_123" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "invalid address",
          inquiryId: "inq_addr_existing",
          sessionToken: "token_addr_existing",
        });
        expect(createInquirySpy).not.toHaveBeenCalled();
      });

      it("resumes existing inquiry for invalid address when inquiry is pending", async () => {
        vi.spyOn(bridge, "onboarding").mockRejectedValue(new Error(bridge.ErrorCodes.INVALID_ADDRESS));
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          id: "inq_addr_pending",
          type: "inquiry" as const,
          attributes: { status: "pending" as const, "reference-id": "ramp-test" },
        });
        const createInquirySpy = vi.spyOn(persona, "createInquiry");
        vi.spyOn(persona, "resumeInquiry").mockResolvedValue({
          data: { id: "inq_addr_pending", type: "inquiry" as const },
          meta: { "session-token": "token_addr_pending" },
        });

        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_123" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "invalid address",
          inquiryId: "inq_addr_pending",
          sessionToken: "token_addr_pending",
        });
        expect(createInquirySpy).not.toHaveBeenCalled();
      });

      it("resumes existing inquiry for invalid address when inquiry is expired", async () => {
        vi.spyOn(bridge, "onboarding").mockRejectedValue(new Error(bridge.ErrorCodes.INVALID_ADDRESS));
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          id: "inq_addr_expired",
          type: "inquiry" as const,
          attributes: { status: "expired" as const, "reference-id": "ramp-test" },
        });
        const createInquirySpy = vi.spyOn(persona, "createInquiry");
        vi.spyOn(persona, "resumeInquiry").mockResolvedValue({
          data: { id: "inq_addr_expired", type: "inquiry" as const },
          meta: { "session-token": "token_addr_expired" },
        });

        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_123" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "invalid address",
          inquiryId: "inq_addr_expired",
          sessionToken: "token_addr_expired",
        });
        expect(createInquirySpy).not.toHaveBeenCalled();
      });

      it("creates new inquiry for invalid address when existing inquiry is not resumable", async () => {
        vi.spyOn(bridge, "onboarding").mockRejectedValue(new Error(bridge.ErrorCodes.INVALID_ADDRESS));
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          id: "inq_addr_approved",
          type: "inquiry" as const,
          attributes: { status: "approved" as const, "reference-id": "ramp-test" },
        });
        vi.spyOn(persona, "createInquiry").mockResolvedValue({
          data: {
            id: "inq_addr_fresh",
            type: "inquiry" as const,
            attributes: { status: "created" as const, "reference-id": "ramp-test" },
          },
        });
        vi.spyOn(persona, "resumeInquiry").mockResolvedValue({
          data: { id: "inq_addr_fresh", type: "inquiry" as const },
          meta: { "session-token": "token_addr_fresh" },
        });

        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_123" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "invalid address",
          inquiryId: "inq_addr_fresh",
          sessionToken: "token_addr_fresh",
        });
        expect(persona.createInquiry).toHaveBeenCalledTimes(1);
      });

      it("returns 500 on unknown bridge error", async () => {
        vi.spyOn(bridge, "onboarding").mockRejectedValue(new Error("unexpected bridge failure"));

        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_123" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(500);
      });

      it("returns 400 for no credential", async () => {
        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_123" } },
          { headers: { "test-credential-id": "non-existent" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "no credential" });
      });
    });
  });
});

const mantecaUser = {
  id: "user123",
  numberId: "456",
  status: "ACTIVE" as const,
  type: "INDIVIDUAL" as const,
  exchange: "ARGENTINA" as const,
  onboarding: {},
  creationTime: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
};

const bridgeCustomer = {
  id: "bridge-customer-123",
  status: "active" as const,
  endorsements: [],
};

const bridgeDepositDetails = {
  network: "ACH" as const,
  accountNumber: "123456789",
  routingNumber: "987654321",
  displayName: "ACH" as const,
  beneficiaryName: "Test User",
  bankName: "Test Bank",
  bankAddress: "123 Test St",
  fee: "0",
  estimatedProcessingTime: "86400",
};
