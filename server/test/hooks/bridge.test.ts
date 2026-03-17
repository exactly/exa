import "../mocks/onesignal";
import "../mocks/sentry";

import { captureEvent, captureException } from "@sentry/core";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { createHash, createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import { hexToBytes, padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";

import database, { credentials } from "../../database";
import app from "../../hooks/bridge";
import * as onesignal from "../../utils/onesignal";
import * as persona from "../../utils/persona";
import * as bridge from "../../utils/ramps/bridge";
import * as segment from "../../utils/segment";

const appClient = testClient(app);

describe("bridge hook", () => {
  const owner = privateKeyToAddress(padHex("0xb1e"));
  const fallbackOwner = privateKeyToAddress(padHex("0xfa11"));
  const conflictOwner = privateKeyToAddress(padHex("0xc0f1"));
  const factory = inject("ExaAccountFactory");
  const account = deriveAddress(factory, { x: padHex(owner), y: zeroHash });
  const fallbackAccount = deriveAddress(factory, { x: padHex(fallbackOwner), y: zeroHash });

  beforeAll(async () => {
    await database.insert(credentials).values([
      {
        id: "bridge-test",
        publicKey: new Uint8Array(hexToBytes(owner)),
        account,
        factory,
        pandaId: "bridgePandaId",
        bridgeId: "bridgeCustomerId",
      },
      {
        id: "fallback-test",
        publicKey: new Uint8Array(hexToBytes(fallbackOwner)),
        account: fallbackAccount,
        factory,
      },
      {
        id: "conflict-test",
        publicKey: new Uint8Array(hexToBytes(conflictOwner)),
        account: deriveAddress(factory, { x: padHex(conflictOwner), y: zeroHash }),
        factory,
        bridgeId: "conflict-bridge-id",
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns 200 with valid signature and payload", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(paymentSubmitted) },
      json: paymentSubmitted as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
  });

  it("returns 401 with missing signature header", async () => {
    const response = await appClient.index.$post({
      header: {},
      json: fundsReceived as never,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized" });
  });

  it("returns 401 with invalid signature", async () => {
    const { privateKey: wrongKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const timestamp = Date.now();
    const digest = createHash("sha256")
      .update(`${timestamp}.${JSON.stringify(fundsReceived)}`)
      .digest();
    const signer = createSign("RSA-SHA256");
    signer.update(digest);
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": `t=${timestamp},v0=${signer.sign(wrongKey, "base64")}` },
      json: fundsReceived as never,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized" });
  });

  it("returns 401 with expired timestamp", async () => {
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(fundsReceived, Date.now() - 600_001) },
      json: fundsReceived as never,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized" });
  });

  it("returns 401 with malformed signature header missing t=", async () => {
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": "v0=abc123" },
      json: fundsReceived as never,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized" });
  });

  it("returns 401 with malformed signature header missing v0=", async () => {
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": `t=${Date.now()}` },
      json: fundsReceived as never,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized" });
  });

  it("returns 200 with bad payload schema", async () => {
    const payload = { invalid: true };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ code: "bad bridge" });
  });

  it("returns 200 without side effects for non-payment virtual account types", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(fundsReceived) },
      json: fundsReceived as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does not track onramp for payment_submitted virtual account", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(paymentSubmitted) },
      json: paymentSubmitted as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).not.toHaveBeenCalled();
  });

  it("sends push notification on payment_submitted virtual account", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(paymentSubmitted) },
      json: paymentSubmitted as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: { en: "Deposited funds" },
      contents: { en: "1000 USD deposited" },
    });
  });

  it("tracks onramp for payment_processed virtual account", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(paymentProcessed) },
      json: paymentProcessed as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).toHaveBeenCalledWith({
      userId: account,
      event: "Onramp",
      properties: { currency: "usd", amount: 1000, provider: "bridge", source: null, usdcAmount: 995 },
    });
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns 200 with credential not found when bridgeId does not match", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const payload = {
      ...fundsReceived,
      event_object: { ...fundsReceived.event_object, customer_id: "unknown-customer" },
    };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "credential not found" });
    expect(segment.track).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("captures sentry exception when credential not found", async () => {
    const payload = {
      ...fundsReceived,
      event_object: { ...fundsReceived.event_object, customer_id: "unknown-customer" },
    };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "credential not found" }),
      { level: "error", contexts: { details: { bridgeId: "unknown-customer" } } },
    );
  });

  it("resolves credential via persona email fallback on status_transitioned", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    vi.spyOn(bridge, "getCustomer").mockResolvedValue({
      id: "fallback-bridge-id",
      email: "fallback@example.com",
      status: "active",
      endorsements: [],
    });
    vi.spyOn(persona, "searchAccounts").mockResolvedValue([{ attributes: { "reference-id": "fallback-test" } }]);
    const payload = {
      ...statusTransitioned,
      event_object: { ...statusTransitioned.event_object, id: "fallback-bridge-id" },
    };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(captureException).not.toHaveBeenCalled();
    expect(captureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "bridge credential paired",
        level: "warning",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        contexts: expect.objectContaining({
          details: { bridgeId: "fallback-bridge-id", referenceId: "fallback-test" },
        }),
      }),
    );
    const updated = await database.query.credentials.findFirst({
      columns: { bridgeId: true },
      where: eq(credentials.id, "fallback-test"),
    });
    expect(updated?.bridgeId).toBe("fallback-bridge-id");
    expect(segment.track).toHaveBeenCalledWith({
      userId: fallbackAccount,
      event: "RampAccount",
      properties: { provider: "bridge", source: null },
    });
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: fallbackAccount,
      headings: { en: "Fiat onramp activated" },
      contents: { en: "Your fiat onramp account has been activated" },
    });
  });

  it("returns 500 when fallback credential already paired", async () => {
    vi.spyOn(database.query.credentials, "findFirst").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
    vi.spyOn(bridge, "getCustomer").mockResolvedValue({
      id: "conflict-bridge-id",
      email: "conflict@example.com",
      status: "active",
      endorsements: [],
    });
    vi.spyOn(persona, "searchAccounts").mockResolvedValue([{ attributes: { "reference-id": "fallback-test" } }]);
    const payload = {
      ...statusTransitioned,
      event_object: { ...statusTransitioned.event_object, id: "conflict-bridge-id" },
    };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(500);
    expect(captureEvent).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns credential not found when multiple persona accounts found on status_transitioned fallback", async () => {
    vi.spyOn(bridge, "getCustomer").mockResolvedValue({
      id: "multi-bridge-id",
      email: "multi@example.com",
      status: "active",
      endorsements: [],
    });
    vi.spyOn(persona, "searchAccounts").mockResolvedValue([
      { attributes: { "reference-id": "ref-1" } },
      { attributes: { "reference-id": "ref-2" } },
    ]);
    const payload = {
      ...statusTransitioned,
      event_object: { ...statusTransitioned.event_object, id: "multi-bridge-id" },
    };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "credential not found" });
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "multiple persona accounts found" }),
      { level: "fatal", contexts: { details: { bridgeId: "multi-bridge-id", matches: 2 } } },
    );
  });

  it("returns credential not found when status_transitioned fallback finds no accounts", async () => {
    vi.spyOn(bridge, "getCustomer").mockResolvedValue({
      id: "empty-bridge-id",
      email: "empty@example.com",
      status: "active",
      endorsements: [],
    });
    vi.spyOn(persona, "searchAccounts").mockResolvedValue([]);
    const payload = {
      ...statusTransitioned,
      event_object: { ...statusTransitioned.event_object, id: "empty-bridge-id" },
    };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "credential not found" });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "credential not found" }),
      { level: "error", contexts: { details: { bridgeId: "empty-bridge-id" } } },
    );
  });

  it("returns 500 when fallback reference-id has no credential", async () => {
    vi.spyOn(bridge, "getCustomer").mockResolvedValue({
      id: "orphan-bridge-id",
      email: "orphan@example.com",
      status: "active",
      endorsements: [],
    });
    vi.spyOn(persona, "searchAccounts").mockResolvedValue([
      { attributes: { "reference-id": "nonexistent-credential" } },
    ]);
    const payload = {
      ...statusTransitioned,
      event_object: { ...statusTransitioned.event_object, id: "orphan-bridge-id" },
    };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(500);
    expect(captureEvent).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("tracks RampAccount and sends notification on status_transitioned to active", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(statusTransitioned) },
      json: statusTransitioned as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).toHaveBeenCalledWith({
      userId: account,
      event: "RampAccount",
      properties: { provider: "bridge", source: null },
    });
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: { en: "Fiat onramp activated" },
      contents: { en: "Your fiat onramp account has been activated" },
    });
  });

  it("returns 200 without tracking for status_transitioned to non-active", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const payload = {
      ...statusTransitioned,
      event_object: { ...statusTransitioned.event_object, status: "incomplete" },
    };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("returns 200 without tracking for customer.updated events", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const payload = { event_type: "customer.updated", event_object: { id: "bridgeCustomerId", status: "active" } };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("captures sentry exception when status_transitioned credential not found and customer not in bridge", async () => {
    vi.spyOn(bridge, "getCustomer").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
    const payload = {
      ...statusTransitioned,
      event_object: { ...statusTransitioned.event_object, id: "unknown-customer" },
    };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "credential not found" });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "credential not found" }),
      { level: "error", contexts: { details: { bridgeId: "unknown-customer" } } },
    );
  });

  it("returns 200 and tracks onramp for drain payment_submitted", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(drain) },
      json: drain as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).toHaveBeenCalledWith({
      userId: account,
      event: "Onramp",
      properties: { currency: "usdc", amount: 500, provider: "bridge", source: null, usdcAmount: 500 },
    });
  });

  it("sends push notification on drain payment_submitted", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(drain) },
      json: drain as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: { en: "Deposited funds" },
      contents: { en: "500 USDC deposited" },
    });
  });

  it("returns 200 with credential not found for drain with unknown customer", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const payload = { ...drain, event_object: { ...drain.event_object, customer_id: "unknown-customer" } };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "credential not found" });
    expect(segment.track).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("captures sentry exception when drain credential not found", async () => {
    const payload = { ...drain, event_object: { ...drain.event_object, customer_id: "unknown-customer" } };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "credential not found" }),
      { level: "error", contexts: { details: { bridgeId: "unknown-customer" } } },
    );
  });

  it("returns 200 without tracking for liquidation_address.drain.updated events", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const payload = { event_type: "liquidation_address.drain.updated", event_object: { id: "drain_123" } };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns 200 without tracking for customer.created events", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const payload = { event_type: "customer.created", event_object: { id: "bridgeCustomerId" } };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns 200 without tracking for liquidation_address.drain.created events", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const payload = { event_type: "liquidation_address.drain.created", event_object: { id: "drain_123" } };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns 200 without tracking for virtual_account.activity.updated events", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const payload = { event_type: "virtual_account.activity.updated", event_object: { id: "evt_123" } };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns 200 without tracking for drain non-payment_submitted state", async () => {
    vi.spyOn(segment, "track").mockReturnValue();
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
    const payload = { ...drain, event_object: { ...drain.event_object, state: "funds_received" } };
    const response = await appClient.index.$post({
      header: { "x-webhook-signature": createSignature(payload) },
      json: payload as never,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(segment.track).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});

const testSigningKey = createPrivateKey(`-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDh/1AC4d9nGevP
7Fe6a+bdoegChtT5oBKMGfR3RRUpvm0YB3vrn4hzunJARZzGOMAfXFD+VV2mDSfL
RCtZlJUUhZmbiMS3SBr9taIH/kWdKT04cRjDIi/ORQentVl/Y/Ea5PcsbG2T/K/+
wydmUTadSS48BVq3Hi3owDr6O+MsANPcuHdgjOV/zsZ3w92h9jjzhLpgm17ImRPu
e18j5L/hfIXNA3tvWxJ0sFIKy6v6NzcyJvS1JBKvyZR/1MatwHnJEaMQ/tMmAyHs
98iYRuqVfWHLwnuPt2lhjEZdlxRC5Mv752731D3LEb/SgWsT0gvCphklJw6VwC6V
8gKR68lhAgMBAAECggEANITelSzke9M8R7+Gy53TsuGzRxMKX1BhvwkxFJ6LQn4s
YA8tLx6N2UcU0fbbbf02OJN9hv1TnAkmnEglQtYSpwg9IDXycR1imF8jXnQqvVEe
FwXBWWeScH7+Pm0YdVBGcZeQEVTJSkDIrY2wlEh/RqIBCpW79R4gURyLGCferRS8
W8qkeDstuc+sf43vlYkmUyqfsDAsSo8QCX5cjKJq+XjF62pXs8Si9IDKnMB4wg/t
925lX+gppQ/0w8K5yl4Y1lG4qS3ZcieqYyR8G00brIvye4RkDIVAnEpSt/IGlVBd
Y9RJx2YuxPxJnwKmM6lPegNvdrua5A+pfRgjKkbl+QKBgQDxT5StHoVHvfa3jw3G
ZXlOW8Tumcwp2RYRO/PX8MEC0G6W5QRDJuIa2im//vIaEv0svlvMfdiSHjRsjFjR
L0rKKMJi7FsgVqoofNtX9XgkVt1bdl29HCIc/PTczOO2F3Gj2hP8zSVotuT2yppm
DMobWvIPWhLkdWdXv85zI8AyRwKBgQDvwRif4n5jjE0CcyRwZlRxXIg+s9FRD7qA
7E/Sln9rx84rne6x1+oLp4GkvtjFdswK7wfS44bpmplT3F0a9aMMxjib+NOpIMBX
FW3XaMvmhgkqAtjVbkiHoqJjcTjJyqXobEuAfkHw9kVZiEA4l4/4r7sj8fToAXFj
R3iTUrQTFwKBgQCMXRcFUDCEl5nwEdUYZyQVkUnO5EUevniYk7/2BsOuiGEbgqFl
EjQJHIeWd4yJ4CvGIAAzxav46nrh/Q0YuKKPTwArHIKxH9ggbugDlPRKZwChWAuU
mc26AOXJnaCC5cYjYhGoRggRjflHGHiRDbVuDgupJGLC4wu2vgovbUc5twKBgQCN
wmCq+KK+fZBzKF2dUAQR2yJ74JqdEW23GQLBg1boBYXz6DfgU8gBCBPxsx4881cG
B/taSEnXCiAqo5sxe5fiz7ldD60mzUSsuPDvcvlM3mfAvVo0KDcea50UqzdmqTmb
yZyC5yRaM2Mh4xwF2ie4ZT+Dq2ahX2kJyJKUmUv8FQKBgEkrv3xpZhKCADrNIyhW
LSumwgofMoFHkyDYZUAbdyj9kY3UHErmD0TZQkHEkL721prfPaEFrjHRVfJ1E6eM
WVPBXOPA2xRr1i4K3aETJd42XMrx0PNe3k05Lf/bCLdjaOEvPkdvDJ3s+vltFA+w
wjKVfw0300Nahs8Jfru7MLNR
-----END PRIVATE KEY-----`); // gitleaks:allow test private key

function createSignature(payload: object, timestamp = Date.now()) {
  const body = JSON.stringify(payload);
  const digest = createHash("sha256").update(`${timestamp}.${body}`).digest();
  const signer = createSign("RSA-SHA256");
  signer.update(digest);
  return `t=${timestamp},v0=${signer.sign(testSigningKey, "base64")}`;
}

const fundsReceived = {
  event_type: "virtual_account.activity.created",
  event_object: {
    id: "evt_123",
    type: "funds_received",
    customer_id: "bridgeCustomerId",
  },
};

const paymentSubmitted = {
  event_type: "virtual_account.activity.created",
  event_object: {
    id: "evt_123",
    type: "payment_submitted",
    currency: "usd",
    customer_id: "bridgeCustomerId",
    receipt: { initial_amount: "1000" },
  },
};

const paymentProcessed = {
  event_type: "virtual_account.activity.created",
  event_object: {
    id: "evt_123",
    type: "payment_processed",
    currency: "usd",
    customer_id: "bridgeCustomerId",
    receipt: { initial_amount: "1000", final_amount: "995" },
  },
};

const statusTransitioned = {
  event_type: "customer.updated.status_transitioned",
  event_object: { id: "bridgeCustomerId", status: "active" },
};

const drain = {
  event_type: "liquidation_address.drain.updated.status_transitioned",
  event_object: {
    id: "drain_123",
    state: "payment_submitted",
    currency: "usdc",
    customer_id: "bridgeCustomerId",
    receipt: { initial_amount: "500", outgoing_amount: "500" },
  },
};

vi.mock("@sentry/core", { spy: true });
