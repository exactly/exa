import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash } from "node:crypto";
import { afterEach, assert, describe, expect, it, vi } from "vitest";

import createWhatsapp from "../../utils/whatsapp";

const whatsapp = createWhatsapp({ from: "sender", key: "chat", token: "whatsapp" });

const audience = "chat-whatsapp";
const issuer = "chat-webhook";
const key = createHash("sha256").update("chat").digest();

describe("whatsapp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a subject with the default expiration", async () => {
    const token = await whatsapp.encode("5491123456789");
    const { payload } = await jwtDecrypt(token, key);
    assert(payload.iat);

    expect(payload.exp).toBe(payload.iat + 3600);
    expect(payload.aud).toBe(audience);
    expect(payload.iss).toBe(issuer);
    await expect(whatsapp.decode(token)).resolves.toBe("5491123456789");
  });

  it("honors a custom expiration", async () => {
    const token = await whatsapp.encode("5491123456789", "2h");
    const { payload } = await jwtDecrypt(token, key);
    assert(payload.iat);

    expect(payload.exp).toBe(payload.iat + 7200);
    await expect(whatsapp.decode(token)).resolves.toBe("5491123456789");
  });

  it("is opaque and rejects a token from a different secret", async () => {
    const token = await whatsapp.encode("5491123456789");
    expect(token).not.toContain("5491123456789");

    await expect(createWhatsapp({ from: "sender", key: "other", token: "whatsapp" }).decode(token)).rejects.toThrow();
  });

  it("rejects a mismatched audience", async () => {
    const token = await new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setSubject("5491123456789")
      .setAudience("password-reset")
      .setIssuer(issuer)
      .setExpirationTime("1h")
      .encrypt(key);

    await expect(whatsapp.decode(token)).rejects.toThrow('unexpected "aud" claim value');
  });

  it("rejects a mismatched issuer", async () => {
    const token = await new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setSubject("5491123456789")
      .setAudience(audience)
      .setIssuer("other-webhook")
      .setExpirationTime("1h")
      .encrypt(key);

    await expect(whatsapp.decode(token)).rejects.toThrow('unexpected "iss" claim value');
  });

  it("rejects an expired token", async () => {
    const token = await whatsapp.encode("5491123456789", Math.floor(Date.now() / 1000) - 1);

    await expect(whatsapp.decode(token)).rejects.toThrow('"exp" claim timestamp check failed');
  });

  it("rejects a token without a subject", async () => {
    const token = await new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setAudience(audience)
      .setIssuer(issuer)
      .setExpirationTime("1h")
      .encrypt(key);

    await expect(whatsapp.decode(token)).rejects.toThrow("missing subject");
  });

  it("rejects a token with a disallowed encryption algorithm", async () => {
    const token = await new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A128CBC-HS256" })
      .setSubject("5491123456789")
      .setAudience(audience)
      .setIssuer(issuer)
      .setExpirationTime("1h")
      .encrypt(key);

    await expect(whatsapp.decode(token)).rejects.toThrow(/not allowed/);
  });

  it("sends a whatsapp text message", async () => {
    const response = new Response("{}");
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await whatsapp.send("5491123456789", "hello");

    expect(response.bodyUsed).toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith("https://graph.facebook.com/v26.0/sender/messages", {
      method: "POST",
      headers: { authorization: "Bearer whatsapp", accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        recipient: "5491123456789",
        type: "text",
        text: { body: "hello" },
      }),
      signal: expect.anything() as AbortSignal,
    });
  });

  it("rejects a whatsapp error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("forbidden", { status: 403 }));

    await expect(whatsapp.send("5491123456789", "hello")).rejects.toMatchObject({
      cause: { message: "forbidden", name: "WhatsApp403", status: 403 },
      message: "forbidden",
      name: "UnrecoverableError",
    });
  });

  it.each([500, 503])("retries a %s response", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("temporary", { status }));

    await expect(whatsapp.send("5491123456789", "hello")).rejects.toMatchObject({
      message: "temporary",
      name: `WhatsApp${status}`,
      status,
    });
  });

  it("retries a transient graph error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error: { is_transient: true, message: "rate limit hit", type: "OAuthException" } },
        { status: 429 },
      ),
    );

    await expect(whatsapp.send("5491123456789", "hello")).rejects.toMatchObject({
      message: "rate limit hit",
      name: "WhatsAppOAuthException",
      status: 429,
    });
  });

  it("does not retry a permanent graph error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: { message: "message undeliverable", type: "OAuthException" } }, { status: 400 }),
    );

    await expect(whatsapp.send("5491123456789", "hello")).rejects.toMatchObject({
      cause: { message: "message undeliverable", name: "WhatsAppOAuthException", status: 400 },
      message: "message undeliverable",
      name: "UnrecoverableError",
    });
  });

  it("does not retry an unknown graph error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 400 }));

    await expect(whatsapp.send("5491123456789", "hello")).rejects.toMatchObject({
      cause: { message: "400", name: "WhatsApp400", status: 400 },
      message: "400",
      name: "UnrecoverableError",
    });
  });
});
