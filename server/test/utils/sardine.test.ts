import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import domain from "@exactly/common/domain";

import createSardine, { cryptoNetwork, passkey } from "../../utils/sardine";

const sardine = createSardine("key:secret", "https://sardine.test");

function sent() {
  const [[url, init]] = vi.mocked(fetch).mock.calls as [[string, RequestInit]];
  return { url, method: init.method, headers: init.headers, body: JSON.parse(init.body as string) as unknown };
}

describe("sardine", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
  });

  afterEach(() => vi.restoreAllMocks());

  it("sends a customer without unverified flags or stamps and ignores checkpoints and rules", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        sessionKey: "session",
        level: "low",
        status: "Success",
        checkpoints: { customer: { riskLevel: { value: 1 } } },
        rules: [{ id: "1" }],
      }),
    );

    await expect(
      sardine.customer({
        flow: { name: "signup", type: "signup" },
        checkpoints: ["customer"],
        customer: { id: "user" },
        device: { userAgent: "Exa/1.0", language: "es-AR" },
      }),
    ).resolves.toStrictEqual({
      sessionKey: "session",
      level: "low",
      status: "Success",
    });

    expect(sent()).toStrictEqual({
      url: "https://sardine.test/v1/customers",
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from("key:secret").toString("base64")}`,
        "X-Request-Id": "00000000-0000-4000-8000-000000000000",
        accept: "application/json",
        "content-type": "application/json",
      },
      body: {
        flow: { id: "00000000-0000-4000-8000-000000000000", name: "signup", type: "signup" },
        sessionKey: "00000000-0000-4000-8000-000000000000",
        checkpoints: ["customer"],
        config: { device: false },
        customer: { id: "user", domain },
        device: { userAgent: "Exa/1.0", language: "es-AR" },
      },
    });
  });

  it("sends issuing risk with unspecified terminal and entry info and parses aml level", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        sessionKey: "session",
        level: "medium",
        status: "Success",
        amlLevel: "high",
        checkpoints: { issuing: { riskLevel: { value: "medium" } } },
        rules: [{ id: 3, name: "rule", isLive: false }],
      }),
    );

    await expect(
      sardine.risk({
        sessionKey: "session",
        customerId: "user",
        transaction: {
          id: "tx",
          amount: 100,
          currencyCode: "usd",
          createdAtMillis: 1, //cspell:ignore createdAtMillis
          address: { countryCode: "AR" },
          merchant: { mcc: "5411" },
        },
        customString: { authorizationMethod: "Normal presentment" },
      }),
    ).resolves.toStrictEqual({
      sessionKey: "session",
      level: "medium",
      status: "Success",
      amlLevel: "high",
    });

    expect(sent()).toMatchObject({
      url: "https://sardine.test/v1/issuing/risks",
      body: {
        sessionKey: "session",
        customerId: "user",
        transaction: {
          id: "tx",
          amount: 100,
          currencyCode: "USD",
          createdAtMillis: 1,
          address: { countryCode: "AR" },
          merchant: { mcc: "5411" },
          terminal: { type: "unspecified", operator: "unspecified" },
          entryInfo: { pan: "unspecified", card: "unspecified", cardHolder: "unspecified" },
        },
        customString: { authorizationMethod: "Normal presentment" },
        partnerId: "EXA",
        partnerName: "EXA",
        workflowName: "issuing_risk",
      },
    });
  });

  it("rejects invalid custom string keys", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      sardine.risk({
        sessionKey: "session",
        customerId: "user",
        transaction: {
          id: "tx",
          amount: 1,
          currencyCode: "USD",
          address: { countryCode: "AR" },
          merchant: { mcc: "1" },
        },
        customString: { "authorization method": "Normal presentment" },
      }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends user scoped issuer declines", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "Success" }));

    await expect(
      sardine.feedback({
        kind: "issuing",
        customer: { id: "user" },
        transaction: { id: "tx" },
        feedback: { type: "authorization", status: "issuer_declined", reason: "InsufficientAccountLiquidity" },
      }),
    ).resolves.toStrictEqual({ status: "Success" });

    expect(sent()).toMatchObject({
      url: "https://sardine.test/v1/feedbacks",
      body: {
        feedback: {
          type: "authorization",
          status: "issuer_declined",
          scope: "user",
          reason: "InsufficientAccountLiquidity",
        },
      },
    });
  });

  it("throws on failed responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(
      sardine.feedback({
        kind: "issuing",
        customer: { id: "user" },
        transaction: { id: "tx" },
        feedback: { type: "settlement", status: "settled" },
      }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("throws on empty responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await expect(sardine.customer({ flow: { name: "signup", type: "signup" } })).rejects.toThrow(
      "Empty response body from /v1/customers",
    );
  });

  it.each([
    ["OPT_SEPOLIA", "optimism"],
    ["BASE_MAINNET", "base"],
    ["ETH_MAINNET", "ethereum"],
    ["BNB_MAINNET", "binance_smart_chain"],
    ["INK_MAINNET", undefined],
    ["ANVIL", undefined],
  ])("maps %s to a sardine network", (alchemy, network) => {
    expect(cryptoNetwork(alchemy)).toBe(network);
  });

  it("tags a device-bound android passkey without optional details", () => {
    expect(
      passkey({
        credentialBackedUp: false,
        credentialDeviceType: "singleDevice",
        origin: "android:apk-key-hash:abc",
        transports: [],
        userVerified: false,
      }),
    ).toStrictEqual([
      { name: "passkey_backed_up", value: "false", type: "string" },
      { name: "passkey_device_type", value: "singleDevice", type: "string" },
      { name: "passkey_user_verified", value: "false", type: "string" },
      { name: "app_platform", value: "android", type: "string" },
    ]);
  });

  it("tags a roaming ios passkey with every detail", () => {
    expect(
      passkey({
        aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
        attachment: "cross-platform",
        credentialBackedUp: true,
        credentialDeviceType: "multiDevice",
        origin: "https://web.exactly.app",
        platform: "ios",
        rpID: "exactly.app",
        transports: ["internal", "hybrid"],
        userVerified: true,
      }),
    ).toStrictEqual([
      { name: "passkey_backed_up", value: "true", type: "string" },
      { name: "passkey_device_type", value: "multiDevice", type: "string" },
      { name: "passkey_user_verified", value: "true", type: "string" },
      { name: "passkey_attachment", value: "cross-platform", type: "string" },
      { name: "passkey_aaguid", value: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4", type: "string" },
      { name: "passkey_transports", value: "hybrid,internal", type: "string" },
      { name: "app_platform", value: "ios", type: "string" },
      { name: "rp_id", value: "exactly.app", type: "string" },
    ]);
  });
});
