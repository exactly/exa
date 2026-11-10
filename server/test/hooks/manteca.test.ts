import "../mocks/manteca";
import sendPushNotificationMock from "../mocks/onesignal";
import * as segment from "../mocks/segment";
import "../mocks/sentry";

import { captureEvent, captureException, setUser } from "@sentry/core";
import { testClient } from "hono/testing";
import { createHmac } from "node:crypto";
import { getAbiItem, hexToBytes, padHex, zeroHash } from "viem";
import { entryPoint06Abi, entryPoint06Address } from "viem/account-abstraction";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";

import database, { credentials } from "../../database";
import createMantecaHook from "../../hooks/manteca";
import t, { f } from "../../i18n";
import createOnesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import createManteca from "../../utils/ramps/manteca";
import createSegment from "../../utils/segment";

const provider = { key: "manteca", url: "https://manteca.test" };
const manteca = createManteca(provider.key, provider.url);
const mantecaHook = createMantecaHook({
  database,
  manteca,
  mantecaWebhookKey: "manteca",
  onesignal: createOnesignal("onesignal"),
  segment: createSegment("segment"),
});
const appClient = testClient(mantecaHook.app);

function createSignature(payload: object) {
  return createHmac("sha256", "manteca")
    .update(Buffer.from(JSON.stringify(payload)))
    .digest("hex");
}

describe("manteca hook", () => {
  const owner = privateKeyToAddress(padHex("0xabc"));
  const factory = exaAccountFactoryAddress;
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
    vi.spyOn(manteca, "withdrawBalance").mockResolvedValue();
    const payload = {
      event: "PAYMENT_REFUND",
      data: {
        refundId: "9b1c8e7a-2f4d-4a6b-8c3e-1d5f7a9b0c2d",
        amount: "5000.00",
        totalAmount: "10000.00",
        asset: "ARS",
        amountToRefund: "4.00",
        totalAmountToRefund: "8.00",
        assetToRefund: "USDT",
        paymentNumberId: "98765",
        paymentExternalId: "my-external-ref-001",
        networkId: "xxx-xxx-xxx-xxx",
        refundReason: "Refund",
        partial: true,
        refundedAt: "2026-02-21T15:35:00.000Z",
        userId: "64a1b2c3d4e5f6a7b8c9d0e2",
        userNumberId: "12345",
        userExternalId: "ext-001",
      },
    };
    const response = await appClient.index.$post({
      header: { "md-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(captureEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: "MantecaPaymentRefund",
        level: "info",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        contexts: expect.objectContaining({
          details: {
            amount: "5000.00",
            asset: "ARS",
            partial: true,
            paymentExternalId: "my-external-ref-001",
            paymentNumberId: "98765",
            refundId: "9b1c8e7a-2f4d-4a6b-8c3e-1d5f7a9b0c2d",
            refundReason: "Refund",
            refundedAt: "2026-02-21T15:35:00.000Z",
            userId: "64a1b2c3d4e5f6a7b8c9d0e2",
            userNumberId: "12345",
          },
        }),
      }),
    );
    expect(captureException).not.toHaveBeenCalled();
    expect(manteca.withdrawBalance).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });

  it("finds the account of a payment refund by the user operation hash", async () => {
    const getLogs = vi.spyOn(publicClient, "getLogs").mockResolvedValueOnce([userOperationEvent(account)] as never);
    const payload = {
      event: "PAYMENT_REFUND",
      data: {
        refundId: "AAA:e49507ed-33f0-4189-a67c-f232f446d33f:4128.09",
        amount: "4128.09",
        asset: "ARS",
        paymentNumberId: "70516",
        paymentExternalId: userOpHash,
        refundReason: "User initiated refund",
        partial: false,
        refundedAt: "2026-11-11T14:16:04.288-03:00",
        userId: "6adff39f0ee31861fc20cdaf",
        userNumberId: "100114168",
        userExternalId: "Exactly-argentina",
      },
    };
    const response = await appClient.index.$post({
      header: { "md-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(getLogs).toHaveBeenCalledExactlyOnceWith(logsQuery);
    expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
    expect(captureEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "MantecaPaymentRefund", level: "info" }),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not look up a payment refund without external id", async () => {
    const getLogs = vi.spyOn(publicClient, "getLogs");
    const payload = {
      event: "PAYMENT_REFUND",
      data: {
        amount: "4128.09",
        asset: "ARS",
        paymentNumberId: "70516",
        refundReason: "User initiated refund",
        partial: false,
        refundedAt: "2026-11-11T14:16:04.288-03:00",
        userId: "6adff39f0ee31861fc20cdaf",
        userNumberId: "100114168",
      },
    };
    const response = await appClient.index.$post({
      header: { "md-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(getLogs).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });

  describe("when a synthetic status is updated", () => {
    it("finds the account of a qr payment by the user operation hash", async () => {
      vi.spyOn(manteca, "withdrawBalance").mockResolvedValue();
      vi.spyOn(manteca, "convertBalanceToUsdc").mockResolvedValue();
      const getLogs = vi.spyOn(publicClient, "getLogs").mockResolvedValueOnce([userOperationEvent(account)] as never);
      const payload = { event: "SYNTHETIC_STATUS_UPDATE", data: { ...refundedSynthetic, externalId: userOpHash } };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(getLogs).toHaveBeenCalledExactlyOnceWith(logsQuery);
      expect(setUser).toHaveBeenCalledExactlyOnceWith({ id: account });
      expect(captureEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: "MantecaSyntheticStatusUpdate",
          level: "info",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          contexts: expect.objectContaining({
            details: { id: "6af4a2b4f66675b8af775fbe", externalId: userOpHash, status: "WAITING", type: "QR3_PAYMENT" },
          }),
        }),
      );
      expect(captureException).not.toHaveBeenCalled();
      expect(manteca.withdrawBalance).not.toHaveBeenCalled();
      expect(manteca.convertBalanceToUsdc).not.toHaveBeenCalled();
    });

    it("captures a qr payment whose user operation is not found", async () => {
      const getLogs = vi.spyOn(publicClient, "getLogs").mockResolvedValueOnce([]);
      const payload = {
        event: "SYNTHETIC_STATUS_UPDATE",
        data: { ...refundedSynthetic, externalId: userOpHash, status: "CANCELLED", currentStage: 5 },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(getLogs).toHaveBeenCalledExactlyOnceWith(logsQuery);
      expect(setUser).not.toHaveBeenCalled();
      expect(captureEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: "MantecaSyntheticStatusUpdate", level: "info" }),
      );
    });

    it("returns ok for a qr payment", async () => {
      vi.spyOn(manteca, "withdrawBalance").mockResolvedValue();
      vi.spyOn(manteca, "convertBalanceToUsdc").mockResolvedValue();
      const payload = {
        event: "SYNTHETIC_STATUS_UPDATE",
        data: {
          id: "65b2c3d4e5f6a7b8c9d0e1f2",
          numberId: "98765",
          externalId: "my-external-ref-001",
          userId: "64a1b2c3d4e5f6a7b8c9d0e2",
          userNumberId: "12345",
          userExternalId: "ext-001",
          sessionId: "session-abc-123",
          status: "COMPLETED",
          type: "QR3_PAYMENT",
          details: {
            depositAddress: "0x1a2b3c4d5e6f...",
            paymentAssetAmount: "15000.00",
            paymentAsset: "ARS",
            paymentAgainstAmount: "12.00",
            paymentAgainst: "USDT",
            paymentPrice: "1250.50",
            priceExpireAt: "2026-02-21T15:30:00.000Z",
            qrType: "QR3",
            nationalId: "2026022100009876",
          },
          currentStage: 2,
          stages: {
            "0": { stageType: "ORDER", asset: "USDT_ARS", operation: "SELL", amount: "12.00" },
            "1": { stageType: "WITHDRAW", asset: "ARS", network: "QR3", amount: "15000.00" },
          },
          creationTime: "2026-02-21T15:25:30.000Z",
          updatedAt: "2026-02-21T15:26:45.000Z",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(captureEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: "MantecaSyntheticStatusUpdate",
          level: "info",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          contexts: expect.objectContaining({
            details: {
              id: "65b2c3d4e5f6a7b8c9d0e1f2",
              externalId: "my-external-ref-001",
              status: "COMPLETED",
              type: "QR3_PAYMENT",
            },
          }),
        }),
      );
      expect(captureException).not.toHaveBeenCalled();
      expect(manteca.withdrawBalance).not.toHaveBeenCalled();
      expect(manteca.convertBalanceToUsdc).not.toHaveBeenCalled();
      expect(setUser).not.toHaveBeenCalled();
    });

    it("returns ok for a waiting qr payment of the company", async () => {
      const payload = { event: "SYNTHETIC_STATUS_UPDATE", data: refundedSynthetic };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(captureEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: "MantecaSyntheticStatusUpdate",
          level: "info",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          contexts: expect.objectContaining({
            details: {
              id: "6af4a2b4f66675b8af775fbe",
              externalId: "exa-sandbox-mwcdqru6-qr3-refund",
              status: "WAITING",
              type: "QR3_PAYMENT",
            },
          }),
        }),
      );
      expect(captureException).not.toHaveBeenCalled();
    });

    it("returns ok for a synthetic without user external id", async () => {
      const payload = {
        event: "SYNTHETIC_STATUS_UPDATE",
        data: {
          id: "687f839bc536d39525e68a6e",
          numberId: "5987",
          externalId: "ramp-ref-478",
          status: "CANCELLED",
          type: "RAMP_OPERATION",
          currentStage: 4,
          details: { depositAddress: "4310001343800000045110", depositAlias: "COMPANY.ARS", price: "1637.70" },
          userId: "685eba4842d304517432f6c5",
          userNumberId: "100009791",
          creationTime: "2025-07-22T09:27:07.506-03:00",
          updatedAt: "2025-07-22T09:33:19.701-03:00",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(captureEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: "MantecaSyntheticStatusUpdate",
          level: "info",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          contexts: expect.objectContaining({
            details: {
              id: "687f839bc536d39525e68a6e",
              externalId: "ramp-ref-478",
              status: "CANCELLED",
              type: "RAMP_OPERATION",
            },
          }),
        }),
      );
      expect(captureException).not.toHaveBeenCalled();
    });
  });

  describe("when a deposit is detected", () => {
    it("converts to USDC", async () => {
      vi.spyOn(manteca, "convertBalanceToUsdc").mockResolvedValue();
      const sendPushNotification = sendPushNotificationMock;
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
      expect(sendPushNotification).toHaveBeenCalledWith({
        userId: account,
        headings: t("Deposited funds"),
        contents: t("{{amount}} {{asset}} deposited", { amount: f("1000"), asset: "ARS" }),
      });
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

    it("logs company events without touching balances", async () => {
      vi.spyOn(manteca, "convertBalanceToUsdc").mockResolvedValue();
      vi.spyOn(segment, "track").mockReturnValue();
      vi.mocked(captureEvent).mockReturnValueOnce("");
      const payload = {
        event: "DEPOSIT_DETECTED",
        data: {
          id: "deposit123",
          asset: "ARS",
          amount: "1000",
          userExternalId: "Exactly-argentina",
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
      expect(captureException).not.toHaveBeenCalled();
      expect(segment.track).not.toHaveBeenCalled();
      expect(sendPushNotificationMock).not.toHaveBeenCalled();
      expect(captureEvent).toHaveBeenCalledWith({
        message: "MantecaCompanyEvent",
        level: "info",
        contexts: { details: { event: "DEPOSIT_DETECTED", ...payload.data } },
      });
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
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
      expect(captureException).toHaveBeenCalledWith(new Error("invalid account address"), {
        level: "error",
        contexts: { details: { rawAccount: "0xinvalid" } }, // cspell:ignore xinvalid
      });
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

    it("captures deposit notification errors", async () => {
      const error = new Error("push failed");
      vi.spyOn(manteca, "convertBalanceToUsdc").mockResolvedValue();
      sendPushNotificationMock.mockRejectedValueOnce(error);
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

      await vi.waitUntil(() => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error));

      expect(captureException).toHaveBeenCalledWith(error, { level: "error" });
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
      vi.spyOn(segment, "track").mockReturnValue();
      const payload = {
        event: "ORDER_STATUS_UPDATE",
        data: {
          id: "order123",
          against: "ARS",
          asset: "USDC",
          assetAmount: "100",
          effectivePrice: "1000",
          exchange: "ARGENTINA",
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
      expect(segment.track).toHaveBeenCalledWith({
        userId: account,
        event: "Onramp",
        properties: { currency: "ARS", amount: 100_000, provider: "manteca", source: null, usdcAmount: 100 },
      });
      expect(manteca.withdrawBalance).toHaveBeenCalledWith("456", "USDC", account);
    });

    it("captures a completed order of the company without withdrawing", async () => {
      vi.spyOn(manteca, "withdrawBalance").mockResolvedValue();
      vi.spyOn(manteca, "convertBalanceToUsdc").mockResolvedValue();
      vi.spyOn(segment, "track").mockReturnValue();
      const payload = {
        event: "ORDER_STATUS_UPDATE",
        data: {
          id: "6af4a2b5f66675b8af775fc4",
          against: "ARS",
          asset: "USDC",
          assetAmount: "5.92562980",
          effectivePrice: "696.65",
          exchange: "ARGENTINA",
          status: "COMPLETED",
          userExternalId: "Exactly-argentina",
          userNumberId: "100114168",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(captureEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: "MantecaCompanyEvent",
          level: "info",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          contexts: expect.objectContaining({ details: { event: "ORDER_STATUS_UPDATE", ...payload.data } }),
        }),
      );
      expect(captureException).not.toHaveBeenCalled();
      expect(segment.track).not.toHaveBeenCalled();
      expect(manteca.withdrawBalance).not.toHaveBeenCalled();
      expect(manteca.convertBalanceToUsdc).not.toHaveBeenCalled();
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

    it("returns ok for cancelled company withdrawal without retrying", async () => {
      vi.spyOn(manteca, "withdrawBalance").mockResolvedValue();
      const payload = {
        event: "WITHDRAW_STATUS_UPDATE",
        data: {
          id: "64b2c3d4e5f6a7b8c9d0e1f2",
          numberId: "318",
          externalId: "withdraw-ref-00441",
          status: "CANCELLED",
          statusMessage: null,
          asset: "USDT",
          amount: "250.000000",
          destination: "0xABCDEF1234567890abcdef1234567890ABCDEF12",
          network: "POLYGON",
          networkId: "0xa1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(captureEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: "MantecaCompanyEvent",
          level: "info",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          contexts: expect.objectContaining({
            details: {
              event: "WITHDRAW_STATUS_UPDATE",
              id: "64b2c3d4e5f6a7b8c9d0e1f2",
              externalId: "withdraw-ref-00441",
              asset: "USDT",
              amount: "250.000000",
              status: "CANCELLED",
            },
          }),
        }),
      );
      expect(captureException).not.toHaveBeenCalled();
      expect(manteca.withdrawBalance).not.toHaveBeenCalled();
    });
  });

  describe("when a merchant withdrawal status is updated", () => {
    it("captures the qr destination as a company event without retrying", async () => {
      vi.spyOn(manteca, "withdrawBalance").mockResolvedValue();
      const destination =
        "ARS-.-4128.09-.-Jorge hanne-.-ARG-.-20608344401-.-qr3refund-.-eyJzZW5kZXIiOnsic2VuZGVyIjp7ImV4Y2hhbmdlIjoiQVJHRU5USU5BIiwibmFtZSI6Ikp1YW4iLCJsZWdhbElkIjoiMzAxMjM0NTYiLCJzdXJuYW1lIjoiUGVyZXoifX0sInBheW1lbnRJbmZvQ29kZSI6ImQyMWM1M2YzLWUzOTgtNDE3Zi1hODkwLTdlZTJmMjhkODM0MiJ9-.-PLUSBILLETERA"; // cspell:ignore hanne eyJzZW5kZXIiOnsic2VuZGVyIjp7ImV4Y2hhbmdlIjoiQVJHRU5USU5BIiwibmFtZSI6Ikp1YW4iLCJsZWdhbElkIjoiMzAxMjM0NTYiLCJzdXJuYW1lIjoiUGVyZXoifX0sInBheW1lbnRJbmZvQ29kZSI6ImQyMWM1M2YzLWUzOTgtNDE3Zi1hODkwLTdlZTJmMjhkODM0MiJ9 PLUSBILLETERA
      const payload = {
        event: "WITHDRAW_STATUS_UPDATE",
        data: {
          amount: "4128.09",
          asset: "ARS",
          creationTime: "2026-11-11T14:15:33.690-03:00",
          destination,
          externalId: userOpHash,
          filledAmount: "0.00",
          id: "6af4a2b5f66675b8af775fd8",
          legalEntity: "WALLET_ARG",
          network: "QR3",
          networkId: "e49507ed-33f0-4189-a67c-f232f446d33f",
          numberId: "100069655",
          sender: '{"exchange":"ARGENTINA","legalId":"24301234569","name":"Juan","surname":"Perez"}',
          status: "CANCELLED",
          updatedAt: "2026-11-11T14:16:04.112-03:00",
          userExternalId: "Exactly-argentina",
          userId: "6adff39f0ee31861fc20cdaf",
          userLegalId: "30123456789",
          userNumberId: "100114168",
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(captureEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: "MantecaCompanyEvent",
          level: "info",
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          contexts: expect.objectContaining({
            details: {
              event: "WITHDRAW_STATUS_UPDATE",
              id: "6af4a2b5f66675b8af775fd8",
              externalId: userOpHash,
              asset: "ARS",
              amount: "4128.09",
              status: "CANCELLED",
            },
          }),
        }),
      );
      expect(captureException).not.toHaveBeenCalled();
      expect(manteca.withdrawBalance).not.toHaveBeenCalled();
    });

    it("captures a refund withdrawal of the company without retrying", async () => {
      vi.spyOn(manteca, "withdrawBalance").mockResolvedValue();
      const payload = {
        event: "WITHDRAW_STATUS_UPDATE",
        data: {
          id: "6af4a7c2f66675b8af7760a1",
          asset: "USDC",
          amount: "5.92",
          userExternalId: "Exactly-argentina",
          status: "CANCELLED",
          userNumberId: "100114168",
          destination: account,
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(captureEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ message: "MantecaCompanyEvent", level: "info" }),
      );
      expect(captureException).not.toHaveBeenCalled();
      expect(manteca.withdrawBalance).not.toHaveBeenCalled();
    });
  });

  describe("when a user onboarding is updated", () => {
    it("tracks and notifies when user is active and identity validation is completed", async () => {
      vi.spyOn(segment, "track").mockReturnValue();
      const sendPushNotification = sendPushNotificationMock;
      const payload = {
        event: "USER_ONBOARDING_UPDATE",
        data: {
          updatedTasks: ["IDENTITY_VALIDATION"],
          user: {
            id: "user123",
            numberId: "456",
            externalId: userExternalId,
            exchange: "ARGENTINA",
            status: "ACTIVE",
            onboarding: { IDENTITY_VALIDATION: { required: true, status: "COMPLETED" as const } },
          },
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(segment.track).toHaveBeenCalledWith({
        userId: account,
        event: "RampAccount",
        properties: { provider: "manteca", source: null },
      });
      expect(sendPushNotification).toHaveBeenCalledWith({
        userId: account,
        headings: t("Fiat onramp activated"),
        contents: t("Your fiat onramp account has been activated"),
      });
    });

    it("captures onboarding notification errors", async () => {
      const error = new Error("push failed");
      vi.spyOn(segment, "track").mockReturnValue();
      sendPushNotificationMock.mockRejectedValueOnce(error);
      const payload = {
        event: "USER_ONBOARDING_UPDATE",
        data: {
          updatedTasks: ["IDENTITY_VALIDATION"],
          user: {
            id: "user123",
            numberId: "456",
            externalId: userExternalId,
            exchange: "ARGENTINA",
            status: "ACTIVE",
            onboarding: { IDENTITY_VALIDATION: { required: true, status: "COMPLETED" as const } },
          },
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      await vi.waitUntil(() => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error));

      expect(captureException).toHaveBeenCalledWith(error, { level: "error" });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    });

    it("does not track or notify when updated task is not identity validation", async () => {
      vi.spyOn(segment, "track").mockReturnValue();
      const sendPushNotification = sendPushNotificationMock;
      const payload = {
        event: "USER_ONBOARDING_UPDATE",
        data: {
          updatedTasks: ["EMAIL_VALIDATION"],
          user: {
            id: "user123",
            numberId: "456",
            externalId: userExternalId,
            exchange: "ARGENTINA",
            status: "ACTIVE",
            onboarding: { IDENTITY_VALIDATION: { required: true, status: "COMPLETED" as const } },
          },
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(segment.track).not.toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it("does not track or notify when identity validation task is not completed", async () => {
      vi.spyOn(segment, "track").mockReturnValue();
      const sendPushNotification = sendPushNotificationMock;
      const payload = {
        event: "USER_ONBOARDING_UPDATE",
        data: {
          updatedTasks: ["IDENTITY_VALIDATION"],
          user: {
            id: "user123",
            numberId: "456",
            externalId: userExternalId,
            exchange: "ARGENTINA",
            status: "ACTIVE",
            onboarding: { IDENTITY_VALIDATION: { required: true, status: "IN_PROGRESS" as const } },
          },
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(segment.track).not.toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it("does not track or notify when identity validation is missing from onboarding", async () => {
      vi.spyOn(segment, "track").mockReturnValue();
      const sendPushNotification = sendPushNotificationMock;
      const payload = {
        event: "USER_ONBOARDING_UPDATE",
        data: {
          updatedTasks: ["IDENTITY_VALIDATION"],
          user: {
            id: "user123",
            numberId: "456",
            externalId: userExternalId,
            exchange: "ARGENTINA",
            status: "ACTIVE",
            onboarding: {},
          },
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(segment.track).not.toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it("does not track or notify when user status is not active", async () => {
      vi.spyOn(segment, "track").mockReturnValue();
      const sendPushNotification = sendPushNotificationMock;
      const payload = {
        event: "USER_ONBOARDING_UPDATE",
        data: {
          updatedTasks: ["IDENTITY_VALIDATION"],
          user: {
            id: "user123",
            numberId: "456",
            externalId: userExternalId,
            exchange: "ARGENTINA",
            status: "ONBOARDING",
            onboarding: { IDENTITY_VALIDATION: { required: true, status: "COMPLETED" as const } },
          },
        },
      };
      const response = await appClient.index.$post({
        header: { "md-webhook-signature": createSignature(payload) },
        json: payload as never,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
      expect(segment.track).not.toHaveBeenCalled();
      expect(sendPushNotification).not.toHaveBeenCalled();
    });
  });
});

vi.mock("@sentry/core", { spy: true });

const userOpHash = padHex("0x4337", { size: 32 });

const logsQuery = {
  address: entryPoint06Address,
  event: getAbiItem({ abi: entryPoint06Abi, name: "UserOperationEvent" }),
  args: { userOpHash },
  fromBlock: "earliest",
  strict: true,
};

function userOperationEvent(sender: string) {
  return { args: { userOpHash, sender, success: true } };
}

const refundedSynthetic = {
  creationTime: "2026-11-11T14:15:32.965-03:00",
  currentStage: 4,
  details: {
    againstAmountOperated: "4128.09",
    assetAmountOperated: "5.92562980",
    merchant: { category: "UNKNOWN", categoryCode: "0000", legalId: "20608344401", name: "Jorge hanne" },
    nationalId: "fake-nationalId-100069655",
    paymentAgainst: "USDC",
    paymentAgainstAmount: "5.92562980",
    paymentAsset: "ARS",
    paymentAssetAmount: "4128.09",
    paymentEffectivePrice: "696.64999997",
    paymentPrice: "696.65000000",
    priceExpireAt: "2026-11-11T14:20:32.749-03:00",
    qrType: "QR3",
    refundedByRecipient: true,
    sender: { exchange: "ARGENTINA", legalId: "30123456", name: "Juan", surname: "Perez" },
  },
  externalId: "exa-sandbox-mwcdqru6-qr3-refund", // cspell:ignore mwcdqru6
  id: "6af4a2b4f66675b8af775fbe",
  numberId: "70516",
  platform: "CRIPTO", // cspell:ignore CRIPTO
  stages: {
    "1": {
      against: "ARS",
      asset: "USDC",
      assetAmount: "5.92562980",
      disallowDebt: false,
      legalEntity: "WALLET_ARG",
      orderId: "6af4a2b5f66675b8af775fc4",
      price: "696.65",
      side: "SELL",
      stageType: "ORDER",
      type: "MARKET",
    },
    "2": {
      amount: "4128.09",
      asset: "ARS",
      destination: {
        address: "ARS-.-4128.09-.-Jorge hanne-.-ARG-.-20608344401-.-qr3refund-.-PLUSBILLETERA",
        network: "QR3",
      },
      legalEntity: "WALLET_ARG",
      stageType: "WITHDRAW",
      withdrawId: "6af4a2b5f66675b8af775fd8",
    },
    "3": {
      amount: "4128.09",
      amountToRefund: "5.92562980",
      asset: "ARS",
      assetToRefund: "USDC",
      fullyRefunded: true,
      internalRefund: false,
      legalEntity: "WALLET_ARG",
      networkId: "e49507ed-33f0-4189-a67c-f232f446d33f",
      partial: false,
      paymentRefundedAmount: "4128.09",
      paymentTotalRefundedAmount: "4128.09",
      refundId: "AAA:e49507ed-33f0-4189-a67c-f232f446d33f:4128.09",
      refundReason: "User initiated refund",
      refundedAt: "2026-11-11T14:16:04.288-03:00",
      stageType: "REFUND",
      totalAmount: "4128.09",
      totalAmountToRefund: "5.92562980",
    },
    "4": { orderId: "6af4a2b5f66675b8af775fc4", stageType: "ORDER_REVERSAL" },
  },
  status: "WAITING",
  type: "QR3_PAYMENT",
  updatedAt: "2026-11-11T14:16:04.383-03:00",
  userExternalId: "Exactly-argentina",
  userId: "6adff39f0ee31861fc20cdaf",
  userNumberId: "100114168",
};
