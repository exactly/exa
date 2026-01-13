import "../mocks/onesignal";
import "../mocks/sentry";

import { testClient } from "hono/testing";
import { createHmac } from "node:crypto";
import { hexToBytes, padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";

import database, { credentials } from "../../database";
import app from "../../hooks/manteca";
import * as manteca from "../../utils/ramps/manteca";

const appClient = testClient(app);

function createSignature(payload: object) {
  return createHmac("sha256", "manteca")
    .update(Buffer.from(JSON.stringify(payload)))
    .digest("hex");
}

describe("manteca hook", () => {
  const owner = privateKeyToAddress(padHex("0xabc"));
  const factory = inject("ExaAccountFactory");
  const account = deriveAddress(factory, { x: padHex(owner), y: zeroHash });
  const userExternalId = account.replace("0x", "");

  beforeAll(async () => {
    await database.insert(credentials).values([
      {
        id: "manteca-test",
        publicKey: new Uint8Array(hexToBytes(owner)),
        account,
        factory,
        pandaId: "mantecaPandaId",
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns 401 with invalid signature on valid payload", async () => {
    const payload = {
      event: "DEPOSIT_DETECTED",
      data: {
        id: "deposit123",
        asset: "ARS",
        amount: "1000",
        userExternalId,
        userNumberId: "456",
        userLegalId: "12345678",
        network: "ARG_FIAT_TRANSFER",
      },
    };
    const wrongSignature = createHmac("sha256", "wrong-key")
      .update(Buffer.from(JSON.stringify(payload)))
      .digest("hex");
    const response = await appClient.index.$post({
      header: { "md-webhook-signature": wrongSignature },
      json: payload as never,
    });

    expect(response.status).toBe(401);
  });

  it("returns 200 with bad payload", async () => {
    const payload = { event: "UNKNOWN_EVENT", data: {} };
    const response = await appClient.index.$post({
      header: { "md-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
  });

  it("returns ok for USER_STATUS_UPDATE deprecated event", async () => {
    const payload = { event: "USER_STATUS_UPDATE", data: { userExternalId } };
    const response = await appClient.index.$post({
      header: { "md-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "deprecated" });
  });

  it("returns ok for SYSTEM_NOTICE", async () => {
    const payload = { event: "SYSTEM_NOTICE", data: { message: "system notice" } };
    const response = await appClient.index.$post({
      header: { "md-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
  });

  it("returns ok for CLOSE_TO_OPERATION_LIMIT notice", async () => {
    const payload = {
      event: "COMPLIANCE_NOTICE",
      data: {
        type: "CLOSE_TO_OPERATION_LIMIT",
        exchange: "ARGENTINA",
        legalId: "12345678",
        message: "close to limit",
        payload: { limit: 1000, operatedAmount: 900, timeframe: "MONTHLY" },
      },
    };
    const response = await appClient.index.$post({
      header: { "md-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
  });

  it("returns ok for OPERATION_LIMIT_UPDATED notice", async () => {
    const payload = {
      event: "COMPLIANCE_NOTICE",
      data: {
        type: "OPERATION_LIMIT_UPDATED",
        exchange: "ARGENTINA",
        message: "limit updated",
        payload: {
          expirationTime: "2024-12-31T23:59:59Z",
          limitAction: "INCREASE",
          timeframe: "MONTHLY",
          updateReason: "compliance review",
        },
      },
    };
    const response = await appClient.index.$post({
      header: { "md-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
  });

  it("returns ok for PAYMENT_REFUND", async () => {
    const payload = {
      event: "PAYMENT_REFUND",
      data: {
        amount: "100",
        asset: "USDC",
        network: "OPTIMISM",
        partial: false,
        paymentNumberId: "123",
        refundReason: "test refund",
        refundedAt: "2024-01-01T00:00:00Z",
        userId: "user123",
        userNumberId: "456",
      },
    };
    const response = await appClient.index.$post({
      header: { "md-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
  });

  describe("when a deposit is detected", () => {
    it("converts to USDC", async () => {
      vi.spyOn(manteca, "convertBalanceToUsdc").mockResolvedValue();
      const payload = {
        event: "DEPOSIT_DETECTED",
        data: {
          id: "deposit123",
          asset: "ARS",
          amount: "1000",
          userExternalId,
          userNumberId: "456",
          userLegalId: "12345678",
          network: "ARG_FIAT_TRANSFER",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(manteca.convertBalanceToUsdc).toHaveBeenCalledWith("456", "ARS");
    });

    it("returns ok if credential does not exist", async () => {
      vi.spyOn(manteca, "convertBalanceToUsdc").mockResolvedValue();
      const payload = {
        event: "DEPOSIT_DETECTED",
        data: {
          id: "deposit123",
          asset: "ARS",
          amount: "1000",
          userExternalId: padHex("0x9", { size: 20 }).slice(2),
          userNumberId: "456",
          userLegalId: "12345678",
          network: "ARG_FIAT_TRANSFER",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      expect(manteca.convertBalanceToUsdc).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toStrictEqual({ code: "credential not found" });
    });

    it("returns ok if account address is invalid", async () => {
      vi.spyOn(manteca, "convertBalanceToUsdc").mockResolvedValue();
      const payload = {
        event: "DEPOSIT_DETECTED",
        data: {
          id: "deposit123",
          asset: "ARS",
          amount: "1000",
          userExternalId: "invalid",
          userNumberId: "456",
          userLegalId: "12345678",
          network: "ARG_FIAT_TRANSFER",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      expect(manteca.convertBalanceToUsdc).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toStrictEqual({ code: "invalid account address" });
    });

    it("handles invalid order size error gracefully", async () => {
      vi.spyOn(manteca, "convertBalanceToUsdc").mockRejectedValue(new Error("invalid order size"));
      const payload = {
        event: "DEPOSIT_DETECTED",
        data: {
          id: "deposit123",
          asset: "ARS",
          amount: "1",
          userExternalId,
          userNumberId: "456",
          userLegalId: "12345678",
          network: "ARG_FIAT_TRANSFER",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    });

    it("does not convert if asset is USDC", async () => {
      vi.spyOn(manteca, "convertBalanceToUsdc").mockResolvedValue();
      const payload = {
        event: "DEPOSIT_DETECTED",
        data: {
          id: "deposit123",
          asset: "USDC",
          amount: "100",
          userExternalId,
          userNumberId: "456",
          userLegalId: "12345678",
          network: "OPTIMISM",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(manteca.convertBalanceToUsdc).not.toHaveBeenCalled();
    });
  });

  describe("when an order status is updated", () => {
    it("handles cancelled order and retries conversion", async () => {
      vi.spyOn(manteca, "convertBalanceToUsdc").mockResolvedValue();
      const payload = {
        event: "ORDER_STATUS_UPDATE",
        data: {
          id: "order123",
          against: "ARS",
          asset: "USDC",
          assetAmount: "100",
          effectivePrice: "1000",
          exchange: "ARGENTINA",
          feeInfo: { companyProfit: "0", custodyFee: "0", platformFee: "0", totalFee: "0" },
          status: "CANCELLED",
          userExternalId,
          userNumberId: "456",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(manteca.convertBalanceToUsdc).toHaveBeenCalledWith("456", "ARS");
    });

    it("handles completed order and withdraws balance", async () => {
      vi.spyOn(manteca, "withdrawBalance").mockResolvedValue();
      const payload = {
        event: "ORDER_STATUS_UPDATE",
        data: {
          id: "order123",
          against: "ARS",
          asset: "USDC",
          assetAmount: "100",
          effectivePrice: "1000",
          exchange: "ARGENTINA",
          feeInfo: { companyProfit: "0", custodyFee: "0", platformFee: "0", totalFee: "0" },
          status: "COMPLETED",
          userExternalId,
          userNumberId: "456",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(manteca.withdrawBalance).toHaveBeenCalledWith("456", "USDC", account);
    });

    it("returns ok for pending order status", async () => {
      const payload = {
        event: "ORDER_STATUS_UPDATE",
        data: {
          id: "order123",
          against: "ARS",
          asset: "USDC",
          assetAmount: "100",
          effectivePrice: "1000",
          exchange: "ARGENTINA",
          feeInfo: { companyProfit: "0", custodyFee: "0", platformFee: "0", totalFee: "0" },
          status: "PENDING",
          userExternalId,
          userNumberId: "456",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    });
  });

  describe("when a withdrawal status is updated", () => {
    it("handles cancelled withdrawal and retries", async () => {
      vi.spyOn(manteca, "withdrawBalance").mockResolvedValue();
      const payload = {
        event: "WITHDRAW_STATUS_UPDATE",
        data: {
          id: "withdraw123",
          asset: "USDC",
          amount: "100",
          userExternalId,
          status: "CANCELLED",
          userNumberId: "456",
          destination: account,
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(manteca.withdrawBalance).toHaveBeenCalledWith("456", "USDC", account);
    });

    it("returns ok for executed withdrawal", async () => {
      const payload = {
        event: "WITHDRAW_STATUS_UPDATE",
        data: {
          id: "withdraw123",
          asset: "USDC",
          amount: "100",
          userExternalId,
          status: "EXECUTED",
          userNumberId: "456",
          destination: account,
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    });

    it("returns ok for pending withdrawal", async () => {
      const payload = {
        event: "WITHDRAW_STATUS_UPDATE",
        data: {
          id: "withdraw123",
          asset: "USDC",
          amount: "100",
          userExternalId,
          status: "PENDING",
          userNumberId: "456",
          destination: account,
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    });
  });

  describe("when a user onboarding is updated", () => {
    it("returns ok when user becomes active", async () => {
      const payload = {
        event: "USER_ONBOARDING_UPDATE",
        data: {
          updatedTasks: ["IDENTITY_VALIDATION"],
          user: {
            email: "test@example.com",
            id: "user123",
            numberId: "456",
            externalId: userExternalId,
            exchange: "ARGENTINA",
            status: "ACTIVE",
          },
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    });

    it("returns ok for onboarding status", async () => {
      const payload = {
        event: "USER_ONBOARDING_UPDATE",
        data: {
          updatedTasks: ["EMAIL_VALIDATION"],
          user: {
            email: "test@example.com",
            id: "user123",
            numberId: "456",
            externalId: userExternalId,
            exchange: "ARGENTINA",
            status: "ONBOARDING",
          },
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    });
  });
});
