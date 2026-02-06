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

      it("returns 400 for unavailable crypto payment rail", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue({
          id: "bridge-customer-123",
          status: "active",
          endorsements: [],
        });
        vi.spyOn(bridge, "getCryptoDepositDetails").mockRejectedValue(
          new Error(bridge.ErrorCodes.NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL),
        );

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", cryptoCurrency: "USDC", network: "TRON" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "not available crypto payment rail" });
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
