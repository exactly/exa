// cspell:ignore SEPA, SPEI, GABCDEFGHIJ
import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/sentry";

import { HTTPException } from "hono/http-exception";
import { testClient } from "hono/testing";
import { parse } from "valibot";
import { hexToBytes, padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { Address } from "@exactly/common/validation";

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
  const deposit = parse(Address, padHex("0xde9", { size: 20 }));

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
        onramp: { currencies: ["ARS", "USD"] },
        status: "NOT_STARTED",
      });
      vi.spyOn(bridge, "getProvider").mockResolvedValue({
        onramp: { currencies: [] },
        offramp: { currencies: [] },
        status: "NOT_AVAILABLE",
      });

      const response = await appClient.index.$get({ query: {} }, { headers: { "test-credential-id": "ramp-test" } });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toStrictEqual({
        manteca: {
          provider: "manteca",
          onramp: { currencies: ["ARS", "USD"] },
          status: "NOT_STARTED",
        },
        bridge: {
          provider: "bridge",
          onramp: { currencies: [] },
          offramp: { currencies: [] },
          status: "NOT_AVAILABLE",
        },
      });
    });

    it("returns NOT_AVAILABLE when manteca provider fails", async () => {
      vi.spyOn(manteca, "getProvider").mockRejectedValue(new Error("manteca error"));
      vi.spyOn(bridge, "getProvider").mockResolvedValue({
        onramp: { currencies: [] },
        offramp: { currencies: [] },
        status: "NOT_AVAILABLE",
      });

      const response = await appClient.index.$get({ query: {} }, { headers: { "test-credential-id": "ramp-test" } });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toStrictEqual({
        manteca: { provider: "manteca", onramp: { currencies: [] }, status: "NOT_AVAILABLE" },
        bridge: {
          provider: "bridge",
          onramp: { currencies: [] },
          offramp: { currencies: [] },
          status: "NOT_AVAILABLE",
        },
      });
    });

    it("returns NOT_AVAILABLE when bridge provider fails", async () => {
      vi.spyOn(manteca, "getProvider").mockResolvedValue({
        onramp: { currencies: ["ARS"] },
        status: "ACTIVE",
      });
      vi.spyOn(bridge, "getProvider").mockRejectedValue(new Error("bridge error"));

      const response = await appClient.index.$get({ query: {} }, { headers: { "test-credential-id": "ramp-test" } });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toStrictEqual({
        manteca: { provider: "manteca", onramp: { currencies: ["ARS"] }, status: "ACTIVE" },
        bridge: {
          provider: "bridge",
          onramp: { currencies: [] },
          offramp: { currencies: [] },
          status: "NOT_AVAILABLE",
        },
      });
    });

    it("forwards valid redirectURL to bridge provider", async () => {
      const mantecaSpy = vi.spyOn(manteca, "getProvider").mockResolvedValue({
        onramp: { currencies: [] },
        status: "NOT_AVAILABLE",
      });
      const bridgeSpy = vi.spyOn(bridge, "getProvider").mockResolvedValue({
        onramp: { currencies: [] },
        offramp: { currencies: [] },
        status: "NOT_AVAILABLE",
      });

      const response = await appClient.index.$get(
        { query: { redirectURL: "https://app.example.com/callback" } },
        { headers: { "test-credential-id": "ramp-test" } },
      );

      expect(response.status).toBe(200);
      expect(mantecaSpy).toHaveBeenCalledOnce();
      expect(bridgeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ redirectURL: "https://app.example.com/callback" }),
      );
    });

    it("returns 400 when redirectURL is not absolute", async () => {
      const mantecaSpy = vi.spyOn(manteca, "getProvider");
      const bridgeSpy = vi.spyOn(bridge, "getProvider");

      const response = await appClient.index.$get(
        { query: { redirectURL: "/callback" } },
        { headers: { "test-credential-id": "ramp-test" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({
        code: "bad request",
        legacy: "bad request",
        message: ['redirectURL Invalid URL: Received "/callback"'],
      });
      expect(mantecaSpy).not.toHaveBeenCalled();
      expect(bridgeSpy).not.toHaveBeenCalled();
    });

    it("returns 400 when redirectURL is malformed", async () => {
      const mantecaSpy = vi.spyOn(manteca, "getProvider");
      const bridgeSpy = vi.spyOn(bridge, "getProvider");

      const response = await appClient.index.$get(
        { query: { redirectURL: "not a url" } },
        { headers: { "test-credential-id": "ramp-test" } },
      );

      expect(response.status).toBe(400);
      expect(mantecaSpy).not.toHaveBeenCalled();
      expect(bridgeSpy).not.toHaveBeenCalled();
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

      it("returns quote and deposit info for manteca ARS", async () => {
        vi.spyOn(manteca, "getUser").mockResolvedValue(mantecaUser);
        vi.spyOn(manteca, "getQuote").mockResolvedValue({ buyRate: "1000", sellRate: "1010" });

        const response = await appClient.quote.$get(
          { query: { provider: "manteca", currency: "ARS" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          quote: { buyRate: "1000", sellRate: "1010" },
          depositInfo: [
            {
              beneficiaryName: "Sixalime Sas", // cspell:ignore Sixalime
              cbu: "0000234100000000000529",
              depositAlias: "exa.ars",
              displayName: "CVU",
              estimatedProcessingTime: "300",
              fee: "0.0",
              network: "ARG_FIAT_TRANSFER",
            },
          ],
        });
      });

      it("returns quote and deposit info for manteca USD", async () => {
        vi.spyOn(manteca, "getUser").mockResolvedValue(mantecaUser);
        vi.spyOn(manteca, "getQuote").mockResolvedValue({ buyRate: "1", sellRate: "1" });

        const response = await appClient.quote.$get(
          { query: { provider: "manteca", currency: "USD" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          quote: { buyRate: "1", sellRate: "1" },
          depositInfo: [
            {
              beneficiaryName: "Sixalime Sas", // cspell:ignore Sixalime
              cbu: "4310009942700000124934",
              depositAlias: "exa.usd",
              displayName: "CBU",
              estimatedProcessingTime: "300",
              fee: "0.0",
              network: "ARG_FIAT_TRANSFER",
            },
          ],
        });
      });

      it("returns quote and deposit info for manteca BRL with pix details", async () => {
        vi.spyOn(manteca, "getUser").mockResolvedValue({ ...mantecaUser, exchange: "BRAZIL" as const });
        vi.spyOn(manteca, "getQuote").mockResolvedValue({ buyRate: "5.50", sellRate: "5.60" });

        const response = await appClient.quote.$get(
          { query: { provider: "manteca", currency: "BRL" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          quote: { buyRate: "5.50", sellRate: "5.60" },
          depositInfo: [
            {
              beneficiaryName: "JUST PAGAMENTOS LTDA", // cspell:ignore PAGAMENTOS LTDA
              displayName: "PIX KEY",
              estimatedProcessingTime: "300",
              fee: "0.0",
              merchantCity: "São Paulo",
              network: "PIX",
              pixKey: "100d6f24-c507-43a1-935c-ba3fb9d1c16d",
              postalCode: "09751-000",
            },
          ],
        });
      });

      it("returns 400 for unsupported currency", async () => {
        vi.spyOn(manteca, "getUser").mockResolvedValue(mantecaUser);

        const response = await appClient.quote.$get(
          { query: { provider: "manteca", currency: "BRL" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "not supported currency" });
      });

      it("rethrows unknown manteca error", async () => {
        vi.spyOn(manteca, "getUser").mockResolvedValue(mantecaUser);
        vi.spyOn(manteca, "getDepositDetails").mockImplementation(() => {
          throw new HTTPException(500, { message: "unexpected manteca failure" });
        });

        const response = await appClient.quote.$get(
          { query: { provider: "manteca", currency: "ARS" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(500);
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

      it("returns quote and deposit info for bridge USD with ACH and WIRE", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
        vi.spyOn(bridge, "getDepositDetails").mockResolvedValue([
          {
            network: "ACH" as const,
            displayName: "ACH" as const,
            beneficiaryName: "Test User",
            routingNumber: "987654321",
            accountNumber: "123456789",
            bankAddress: "123 Test St",
            beneficiaryAddress: "456 Beneficiary Ave",
            bankName: "Test Bank",
            fee: "0.0",
            estimatedProcessingTime: "1 - 3 business days",
          },
          {
            network: "WIRE" as const,
            displayName: "WIRE" as const,
            beneficiaryName: "Test User",
            routingNumber: "987654321",
            accountNumber: "123456789",
            bankAddress: "123 Test St",
            beneficiaryAddress: "456 Beneficiary Ave",
            bankName: "Test Bank",
            fee: "0.0",
            estimatedProcessingTime: "300",
          },
        ]);
        vi.spyOn(bridge, "getQuote").mockResolvedValue({ buyRate: "1.00", sellRate: "1.00" });

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "USD" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          quote: { buyRate: "1.00", sellRate: "1.00" },
          depositInfo: [
            {
              network: "ACH",
              displayName: "ACH",
              beneficiaryName: "Test User",
              routingNumber: "987654321",
              accountNumber: "123456789",
              bankAddress: "123 Test St",
              beneficiaryAddress: "456 Beneficiary Ave",
              bankName: "Test Bank",
              fee: "0.0",
              estimatedProcessingTime: "1 - 3 business days",
            },
            {
              network: "WIRE",
              displayName: "WIRE",
              beneficiaryName: "Test User",
              routingNumber: "987654321",
              accountNumber: "123456789",
              bankAddress: "123 Test St",
              beneficiaryAddress: "456 Beneficiary Ave",
              bankName: "Test Bank",
              fee: "0.0",
              estimatedProcessingTime: "300",
            },
          ],
        });
      });

      it("returns quote and deposit info for bridge EUR with SEPA", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
        vi.spyOn(bridge, "getDepositDetails").mockResolvedValue([
          {
            network: "SEPA" as const,
            displayName: "SEPA" as const,
            beneficiaryName: "Test User",
            iban: "DE89370400440532013000", // cspell:ignore iban
            fee: "0.0",
            estimatedProcessingTime: "300",
          },
        ]);
        vi.spyOn(bridge, "getQuote").mockResolvedValue({ buyRate: "0.92", sellRate: "0.93" });

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "EUR" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          quote: { buyRate: "0.92", sellRate: "0.93" },
          depositInfo: [
            {
              network: "SEPA",
              displayName: "SEPA",
              beneficiaryName: "Test User",
              iban: "DE89370400440532013000",
              fee: "0.0",
              estimatedProcessingTime: "300",
            },
          ],
        });
      });

      it("returns quote and deposit info for bridge MXN with SPEI", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
        vi.spyOn(bridge, "getDepositDetails").mockResolvedValue([
          {
            network: "SPEI" as const,
            displayName: "SPEI" as const,
            beneficiaryName: "Test User",
            clabe: "032180000118359719", // cspell:ignore clabe
            fee: "0.0",
            estimatedProcessingTime: "300",
          },
        ]);
        vi.spyOn(bridge, "getQuote").mockResolvedValue({ buyRate: "17.20", sellRate: "17.30" });

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "MXN" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          quote: { buyRate: "17.20", sellRate: "17.30" },
          depositInfo: [
            {
              network: "SPEI",
              displayName: "SPEI",
              beneficiaryName: "Test User",
              clabe: "032180000118359719",
              fee: "0.0",
              estimatedProcessingTime: "300",
            },
          ],
        });
      });

      it("returns quote and deposit info for bridge BRL with PIX-BR", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
        vi.spyOn(bridge, "getDepositDetails").mockResolvedValue([
          {
            network: "PIX-BR" as const,
            displayName: "PIX BR" as const,
            beneficiaryName: "Test User",
            brCode: "00020126360014BR.GOV.BCB.PIX", // cspell:ignore brCode
            fee: "0.0",
            estimatedProcessingTime: "300",
          },
        ]);
        vi.spyOn(bridge, "getQuote").mockResolvedValue({ buyRate: "5.10", sellRate: "5.20" });

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "BRL" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          quote: { buyRate: "5.10", sellRate: "5.20" },
          depositInfo: [
            {
              network: "PIX-BR",
              displayName: "PIX BR",
              beneficiaryName: "Test User",
              brCode: "00020126360014BR.GOV.BCB.PIX",
              fee: "0.0",
              estimatedProcessingTime: "300",
            },
          ],
        });
      });

      it("returns quote and deposit info for bridge GBP with faster payments", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
        vi.spyOn(bridge, "getDepositDetails").mockResolvedValue([
          {
            network: "FASTER_PAYMENTS" as const,
            displayName: "Faster Payments" as const,
            accountNumber: "12345678",
            sortCode: "040004",
            accountHolderName: "Test User",
            bankName: "Test Bank",
            bankAddress: "London, UK",
            fee: "0.0",
            estimatedProcessingTime: "300",
          },
        ]);
        vi.spyOn(bridge, "getQuote").mockResolvedValue({ buyRate: "0.79", sellRate: "0.80" });

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "GBP" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          quote: { buyRate: "0.79", sellRate: "0.80" },
          depositInfo: [
            {
              network: "FASTER_PAYMENTS",
              displayName: "Faster Payments",
              accountNumber: "12345678",
              sortCode: "040004",
              accountHolderName: "Test User",
              bankName: "Test Bank",
              bankAddress: "London, UK",
              fee: "0.0",
              estimatedProcessingTime: "300",
            },
          ],
        });
      });

      it("returns deposit info with undefined quote for bridge USDT/TRON", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
        vi.spyOn(bridge, "getCryptoDepositDetails").mockResolvedValue([
          {
            network: "TRON" as const,
            displayName: "TRON" as const,
            address: "TXyz123456789",
            fee: "0.0",
            estimatedProcessingTime: "300",
          },
        ]);

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "USDT", network: "TRON" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          depositInfo: [
            {
              network: "TRON",
              displayName: "TRON",
              address: "TXyz123456789",
              fee: "0.0",
              estimatedProcessingTime: "300",
            },
          ],
        });
      });

      it("returns deposit info with default quote for bridge USDC/SOLANA", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
        vi.spyOn(bridge, "getCryptoDepositDetails").mockResolvedValue([
          {
            network: "SOLANA" as const,
            displayName: "SOLANA" as const,
            address: "So1anaAddress123",
            fee: "0.0",
            estimatedProcessingTime: "300",
          },
        ]);

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "USDC", network: "SOLANA" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          quote: { buyRate: "1.0", sellRate: "1.0" },
          depositInfo: [
            {
              network: "SOLANA",
              displayName: "SOLANA",
              address: "So1anaAddress123",
              fee: "0.0",
              estimatedProcessingTime: "300",
            },
          ],
        });
      });

      it("returns deposit info with default quote for bridge USDC/STELLAR", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
        vi.spyOn(bridge, "getCryptoDepositDetails").mockResolvedValue([
          {
            network: "STELLAR" as const,
            displayName: "STELLAR" as const,
            address: "STELLAR123456",
            fee: "0.0",
            estimatedProcessingTime: "300",
            memo: "789012",
          },
        ]);

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "USDC", network: "STELLAR" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          quote: { buyRate: "1.0", sellRate: "1.0" },
          depositInfo: [
            {
              network: "STELLAR",
              displayName: "STELLAR",
              address: "STELLAR123456",
              fee: "0.0",
              estimatedProcessingTime: "300",
              memo: "789012",
            },
          ],
        });
      });

      it("returns deposit info with default quote for bridge USDC/BASE", async () => {
        vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
        vi.spyOn(bridge, "getCryptoDepositDetails").mockResolvedValue([
          {
            network: "BASE" as const,
            displayName: "BASE" as const,
            address: deposit,
            fee: "0.0",
            estimatedProcessingTime: "300",
          },
        ]);

        const response = await appClient.quote.$get(
          { query: { provider: "bridge", currency: "USDC", network: "BASE" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({
          quote: { buyRate: "1.0", sellRate: "1.0" },
          depositInfo: [
            {
              network: "BASE",
              displayName: "BASE",
              address: deposit,
              fee: "0.0",
              estimatedProcessingTime: "300",
            },
          ],
        });
      });

      describe("offramp", () => {
        it("returns 400 when bridgeId is missing", async () => {
          const response = await appClient.quote.$get(
            {
              query: {
                provider: "bridge",
                currency: "USD",
                direction: "offramp",
                externalAccountId: "ext-acc-1",
              },
            },
            { headers: { "test-credential-id": "ramp-test" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
        });

        it("returns 400 when bridge customer not found", async () => {
          vi.spyOn(bridge, "getCustomer").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined

          const response = await appClient.quote.$get(
            {
              query: {
                provider: "bridge",
                currency: "USD",
                direction: "offramp",
                externalAccountId: "ext-acc-1",
              },
            },
            { headers: { "test-credential-id": "ramp-bridge" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
        });

        it("returns 400 when external account is not found", async () => {
          vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
          vi.spyOn(bridge, "getQuote").mockResolvedValue({ buyRate: "1.00", sellRate: "1.00" });
          vi.spyOn(bridge, "getOfframpDepositDetails").mockRejectedValue(
            new Error(bridge.ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND),
          );

          const response = await appClient.quote.$get(
            {
              query: {
                provider: "bridge",
                currency: "USD",
                direction: "offramp",
                externalAccountId: "ext-acc-missing",
              },
            },
            { headers: { "test-credential-id": "ramp-bridge" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "external account not found" });
        });

        it("returns 500 when bridge util throws an unexpected error", async () => {
          vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
          vi.spyOn(bridge, "getQuote").mockResolvedValue({ buyRate: "1.00", sellRate: "1.00" });
          vi.spyOn(bridge, "getOfframpDepositDetails").mockRejectedValue(new Error("unexpected"));

          const response = await appClient.quote.$get(
            {
              query: {
                provider: "bridge",
                currency: "USD",
                direction: "offramp",
                externalAccountId: "ext-acc-1",
              },
            },
            { headers: { "test-credential-id": "ramp-bridge" } },
          );

          expect(response.status).toBe(500);
        });

        it("returns quote and deposit info for USD offramp", async () => {
          vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
          vi.spyOn(bridge, "getQuote").mockResolvedValue({ buyRate: "1.00", sellRate: "1.00" });
          vi.spyOn(bridge, "getOfframpDepositDetails").mockResolvedValue([
            {
              network: "OPTIMISM" as const,
              displayName: "Optimism" as const,
              address: deposit,
              fee: "0.0",
              estimatedProcessingTime: "300",
            },
          ]);

          const response = await appClient.quote.$get(
            {
              query: {
                provider: "bridge",
                currency: "USD",
                direction: "offramp",
                externalAccountId: "ext-acc-1",
              },
            },
            { headers: { "test-credential-id": "ramp-bridge" } },
          );

          expect(response.status).toBe(200);
          await expect(response.json()).resolves.toStrictEqual({
            quote: { buyRate: "1.00", sellRate: "1.00" },
            depositInfo: [
              {
                network: "OPTIMISM",
                displayName: "Optimism",
                address: deposit,
                fee: "0.0",
                estimatedProcessingTime: "300",
              },
            ],
          });
          expect(bridge.getOfframpDepositDetails).toHaveBeenCalledWith(
            "ext-acc-1",
            expect.any(String),
            bridgeCustomer,
            "USD",
          );
        });

        it("returns 400 when crypto offramp to_address is invalid", async () => {
          vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
          vi.spyOn(bridge, "getCryptoOfframpDepositDetails").mockRejectedValue(
            new Error(bridge.ErrorCodes.INVALID_DEPOSIT_ADDRESS),
          );

          const response = await appClient.quote.$get(
            {
              query: {
                provider: "bridge",
                currency: "USDT",
                direction: "offramp",
                network: "TRON",
                address: "not-a-tron-address",
              },
            },
            { headers: { "test-credential-id": "ramp-bridge" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({ code: "invalid deposit address" });
        });

        it("returns 500 when crypto offramp util throws an unexpected error", async () => {
          vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
          vi.spyOn(bridge, "getCryptoOfframpDepositDetails").mockRejectedValue(new Error("unexpected"));

          const response = await appClient.quote.$get(
            {
              query: {
                provider: "bridge",
                currency: "USDT",
                direction: "offramp",
                network: "TRON",
                address: "TXyz",
              },
            },
            { headers: { "test-credential-id": "ramp-bridge" } },
          );

          expect(response.status).toBe(500);
        });

        it("returns 400 when STELLAR offramp is missing the memo", async () => {
          const cryptoSpy = vi.spyOn(bridge, "getCryptoOfframpDepositDetails");

          const response = await appClient.quote.$get(
            {
              query: {
                provider: "bridge",
                currency: "USDC",
                direction: "offramp",
                network: "STELLAR",
                address: "GABCDEFGHIJ",
              } as never,
            },
            { headers: { "test-credential-id": "ramp-bridge" } },
          );

          expect(response.status).toBe(400);
          expect(cryptoSpy).not.toHaveBeenCalled();
        });
      });
    });
  });

  describe("onboarding", () => {
    describe("manteca", () => {
      it("onboards manteca successfully", async () => {
        vi.spyOn(manteca, "onboarding").mockResolvedValue();

        const response = await appClient.index.$post(
          { json: { provider: "manteca" } },
          { headers: { "test-credential-id": "ramp-test" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
        expect(manteca.onboarding).toHaveBeenCalledWith(account, "ramp-test");
      });

      it("returns 400 with new inquiry for invalid legal id when no existing inquiry", async () => {
        vi.spyOn(manteca, "onboarding").mockRejectedValue(new Error(manteca.ErrorCodes.INVALID_LEGAL_ID));
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
        vi.spyOn(manteca, "onboarding").mockRejectedValue(new Error(manteca.ErrorCodes.INVALID_LEGAL_ID));
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
        vi.spyOn(manteca, "onboarding").mockRejectedValue(new Error(manteca.ErrorCodes.INVALID_LEGAL_ID));
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
        vi.spyOn(manteca, "onboarding").mockRejectedValue(new Error(manteca.ErrorCodes.NO_DOCUMENT));

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

      it("returns 400 when country is denylisted", async () => {
        vi.spyOn(bridge, "onboarding").mockRejectedValue(new Error(bridge.ErrorCodes.DENYLISTED_COUNTRY));

        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_123" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "denylisted country" });
      });

      it("returns 400 when bridge is not enabled", async () => {
        vi.spyOn(bridge, "onboarding").mockRejectedValue(new Error(bridge.ErrorCodes.NOT_ENABLED));

        const response = await appClient.index.$post(
          { json: { provider: "bridge", acceptedTermsId: "terms_123" } },
          { headers: { "test-credential-id": "ramp-bridge" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "not enabled" });
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
        vi.spyOn(bridge, "onboarding").mockRejectedValue(
          new HTTPException(500, { message: "unexpected bridge failure" }),
        );

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

  describe("create external account", () => {
    const input = {
      currency: "USD" as const,
      accountOwnerName: "John Doe",
      accountNumber: "1210002481111",
      routingNumber: "121000248",
      address: { streetLine1: "123 Main St", city: "Anytown", state: "CA", country: "USA" }, // cspell:ignore anytown
    };

    it("returns 400 for no credential", async () => {
      const response = await appClient["external-account"].$post(
        { json: input },
        { headers: { "test-credential-id": "non-existent" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "no credential" });
    });

    it("returns 400 when bridgeId is missing", async () => {
      const response = await appClient["external-account"].$post(
        { json: input },
        { headers: { "test-credential-id": "ramp-test" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
    });

    it("returns 400 when bridge customer not found", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
      const createSpy = vi.spyOn(bridge, "createExternalAccount");

      const response = await appClient["external-account"].$post(
        { json: input },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("returns 400 when customer is not active", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue({ ...bridgeCustomer, status: "under_review" });
      const createSpy = vi.spyOn(bridge, "createExternalAccount");

      const response = await appClient["external-account"].$post(
        { json: input },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not approved" });
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("returns 400 for input without account details", async () => {
      const createSpy = vi.spyOn(bridge, "createExternalAccount");

      const response = await appClient["external-account"].$post(
        { json: { currency: "USD" } as never },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      expect(createSpy).not.toHaveBeenCalled();
    });

    it("returns 400 when the customer lacks the required endorsement", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      vi.spyOn(bridge, "createExternalAccount").mockRejectedValue(new Error(bridge.ErrorCodes.NO_ENDORSEMENT));

      const response = await appClient["external-account"].$post(
        { json: input },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not approved" });
    });

    it("returns 500 when bridge util throws an unexpected error", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      vi.spyOn(bridge, "createExternalAccount").mockRejectedValue(new Error("unexpected"));

      const response = await appClient["external-account"].$post(
        { json: input },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(500);
    });

    it("delegates to createExternalAccount and returns the external account", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      const createSpy = vi.spyOn(bridge, "createExternalAccount").mockResolvedValue(externalAccount);

      const response = await appClient["external-account"].$post(
        { json: input },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual(externalAccount);
      expect(createSpy).toHaveBeenCalledWith(bridgeCustomer, input);
    });
  });

  describe("list external accounts", () => {
    it("returns 400 for no credential", async () => {
      const response = await appClient["external-account"].$get(
        {},
        { headers: { "test-credential-id": "non-existent" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "no credential" });
    });

    it("returns 400 when bridgeId is missing", async () => {
      const response = await appClient["external-account"].$get({}, { headers: { "test-credential-id": "ramp-test" } });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
    });

    it("returns 400 when bridge customer not found", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
      const listSpy = vi.spyOn(bridge, "listExternalAccounts");

      const response = await appClient["external-account"].$get(
        {},
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
      expect(listSpy).not.toHaveBeenCalled();
    });

    it("returns 400 when customer is not active", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue({ ...bridgeCustomer, status: "under_review" });
      const listSpy = vi.spyOn(bridge, "listExternalAccounts");

      const response = await appClient["external-account"].$get(
        {},
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not approved" });
      expect(listSpy).not.toHaveBeenCalled();
    });

    it("delegates to listExternalAccounts and returns the external accounts", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      const listSpy = vi.spyOn(bridge, "listExternalAccounts").mockResolvedValue([externalAccount]);

      const response = await appClient["external-account"].$get(
        {},
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual([externalAccount]);
      expect(listSpy).toHaveBeenCalledWith("bridge-customer-123");
    });
  });

  describe("update external account", () => {
    const address = { streetLine1: "10 Downing St", city: "London", state: "ENG", country: "GBR", postalCode: "SW1A" };

    it("returns 400 for no credential", async () => {
      const response = await appClient["external-account"][":id"].$patch(
        { param: { id: "ext-acc-1" }, json: { currency: "USD", address } },
        { headers: { "test-credential-id": "non-existent" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "no credential" });
    });

    it("returns 400 when bridgeId is missing", async () => {
      const response = await appClient["external-account"][":id"].$patch(
        { param: { id: "ext-acc-1" }, json: { currency: "USD", address } },
        { headers: { "test-credential-id": "ramp-test" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
    });

    it("returns 400 when bridge customer not found", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
      const updateSpy = vi.spyOn(bridge, "updateExternalAccount");

      const response = await appClient["external-account"][":id"].$patch(
        { param: { id: "ext-acc-1" }, json: { currency: "USD", address } },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("returns 400 when customer is not active", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue({ ...bridgeCustomer, status: "under_review" });
      const updateSpy = vi.spyOn(bridge, "updateExternalAccount");

      const response = await appClient["external-account"][":id"].$patch(
        { param: { id: "ext-acc-1" }, json: { currency: "USD", address } },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not approved" });
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("returns 400 for input without currency", async () => {
      const updateSpy = vi.spyOn(bridge, "updateExternalAccount");

      const response = await appClient["external-account"][":id"].$patch(
        { param: { id: "ext-acc-1" }, json: { address } as never },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("returns 400 when external account is not found", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      vi.spyOn(bridge, "updateExternalAccount").mockRejectedValue(
        new Error(bridge.ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND),
      );

      const response = await appClient["external-account"][":id"].$patch(
        { param: { id: "ext-acc-missing" }, json: { currency: "USD", address } },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "external account not found" });
    });

    it("returns 500 when bridge util throws an unexpected error", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      vi.spyOn(bridge, "updateExternalAccount").mockRejectedValue(new Error("unexpected"));

      const response = await appClient["external-account"][":id"].$patch(
        { param: { id: "ext-acc-1" }, json: { currency: "USD", address } },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(500);
    });

    it("delegates to updateExternalAccount and returns the external account", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      const updateSpy = vi.spyOn(bridge, "updateExternalAccount").mockResolvedValue(externalAccount);

      const response = await appClient["external-account"][":id"].$patch(
        {
          param: { id: "ext-acc-1" },
          json: { currency: "USD", address, account: { routingNumber: "121000248" } },
        },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual(externalAccount);
      expect(updateSpy).toHaveBeenCalledWith(bridgeCustomer, "ext-acc-1", {
        currency: "USD",
        address,
        account: { routingNumber: "121000248" },
      });
    });

    it("drops account for non-us accounts", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      const updateSpy = vi
        .spyOn(bridge, "updateExternalAccount")
        .mockResolvedValue({ ...externalAccount, currency: "EUR", addressValid: undefined });

      const response = await appClient["external-account"][":id"].$patch(
        {
          param: { id: "ext-acc-1" },
          json: { currency: "EUR", address, account: { routingNumber: "121000248" } } as never,
        },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({
        bankName: "Test Bank",
        currency: "EUR",
        id: "ext-acc-1",
        ownerName: "John Doe",
      });
      expect(updateSpy).toHaveBeenCalledWith(bridgeCustomer, "ext-acc-1", { currency: "EUR", address });
    });
  });

  describe("delete external account", () => {
    it("returns 400 for no credential", async () => {
      const response = await appClient["external-account"][":id"].$delete(
        { param: { id: "ext-acc-1" } },
        { headers: { "test-credential-id": "non-existent" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "no credential" });
    });

    it("returns 400 when bridgeId is missing", async () => {
      const response = await appClient["external-account"][":id"].$delete(
        { param: { id: "ext-acc-1" } },
        { headers: { "test-credential-id": "ramp-test" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
    });

    it("returns 400 when bridge customer not found", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
      const removeSpy = vi.spyOn(bridge, "removeExternalAccount");

      const response = await appClient["external-account"][":id"].$delete(
        { param: { id: "ext-acc-1" } },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it("returns 400 when customer is not active", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue({ ...bridgeCustomer, status: "under_review" });
      const removeSpy = vi.spyOn(bridge, "removeExternalAccount");

      const response = await appClient["external-account"][":id"].$delete(
        { param: { id: "ext-acc-1" } },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "not approved" });
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it("returns 400 when external account is not found", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      vi.spyOn(bridge, "removeExternalAccount").mockRejectedValue(
        new Error(bridge.ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND),
      );

      const response = await appClient["external-account"][":id"].$delete(
        { param: { id: "ext-acc-missing" } },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "external account not found" });
    });

    it("returns 400 when a withdrawal is in progress", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      vi.spyOn(bridge, "removeExternalAccount").mockRejectedValue(new Error(bridge.ErrorCodes.TRANSFER_IN_USE));

      const response = await appClient["external-account"][":id"].$delete(
        { param: { id: "ext-acc-1" } },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toStrictEqual({ code: "withdrawal in progress" });
    });

    it("returns 500 when bridge util throws an unexpected error", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      vi.spyOn(bridge, "removeExternalAccount").mockRejectedValue(new Error("unexpected"));

      const response = await appClient["external-account"][":id"].$delete(
        { param: { id: "ext-acc-1" } },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(500);
    });

    it("delegates to removeExternalAccount and returns ok", async () => {
      vi.spyOn(bridge, "getCustomer").mockResolvedValue(bridgeCustomer);
      const removeSpy = vi.spyOn(bridge, "removeExternalAccount").mockResolvedValue();

      const response = await appClient["external-account"][":id"].$delete(
        { param: { id: "ext-acc-1" } },
        { headers: { "test-credential-id": "ramp-bridge" } },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(removeSpy).toHaveBeenCalledWith(bridgeCustomer, "ext-acc-1");
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
  email: "test@example.com",
  status: "active" as const,
  endorsements: [],
};

const externalAccount = {
  addressValid: true,
  bankName: "Test Bank",
  currency: "USD" as const,
  id: "ext-acc-1",
  ownerName: "John Doe",
};
