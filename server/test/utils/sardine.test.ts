import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import domain from "@exactly/common/domain";

import createSardine from "../../utils/sardine";

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
});
