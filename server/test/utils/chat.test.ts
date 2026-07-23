import { EncryptJWT, jwtDecrypt } from "jose";
import { createHash } from "node:crypto";
import { assert, describe, expect, it, vi } from "vitest";

import { decode, encode } from "../../utils/chat";

const audience = "chat-whatsapp";
const issuer = "chat-webhook";
const key = createHash("sha256").update("chat").digest();

describe("token", () => {
  it("round-trips a subject with the default expiration", async () => {
    const token = await encode("5491123456789");
    const { payload } = await jwtDecrypt(token, key);
    assert(payload.iat);

    expect(payload.exp).toBe(payload.iat + 3600);
    expect(payload.aud).toBe(audience);
    expect(payload.iss).toBe(issuer);
    await expect(decode(token)).resolves.toBe("5491123456789");
  });

  it("honors a custom expiration", async () => {
    const token = await encode("5491123456789", "2h");
    const { payload } = await jwtDecrypt(token, key);
    assert(payload.iat);

    expect(payload.exp).toBe(payload.iat + 7200);
    await expect(decode(token)).resolves.toBe("5491123456789");
  });

  it("is opaque and rejects a token from a different secret", async () => {
    const token = await encode("5491123456789");
    expect(token).not.toContain("5491123456789");

    const forged = await new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setSubject("5491123456789")
      .setAudience(audience)
      .setIssuer(issuer)
      .setExpirationTime("1h")
      .encrypt(createHash("sha256").update("other").digest());
    await expect(decode(forged)).rejects.toThrow();
  });

  it("rejects a mismatched audience", async () => {
    const token = await new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setSubject("5491123456789")
      .setAudience("password-reset")
      .setIssuer(issuer)
      .setExpirationTime("1h")
      .encrypt(key);

    await expect(decode(token)).rejects.toThrow('unexpected "aud" claim value');
  });

  it("rejects a mismatched issuer", async () => {
    const token = await new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setSubject("5491123456789")
      .setAudience(audience)
      .setIssuer("other-webhook")
      .setExpirationTime("1h")
      .encrypt(key);

    await expect(decode(token)).rejects.toThrow('unexpected "iss" claim value');
  });

  it("rejects an expired token", async () => {
    const token = await encode("5491123456789", Math.floor(Date.now() / 1000) - 1);

    await expect(decode(token)).rejects.toThrow('"exp" claim timestamp check failed');
  });

  it("rejects a token without a subject", async () => {
    const token = await new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .setAudience(audience)
      .setIssuer(issuer)
      .setExpirationTime("1h")
      .encrypt(key);

    await expect(decode(token)).rejects.toThrow("missing subject");
  });

  it("rejects a token with a disallowed encryption algorithm", async () => {
    const token = await new EncryptJWT({})
      .setProtectedHeader({ alg: "dir", enc: "A128CBC-HS256" })
      .setSubject("5491123456789")
      .setAudience(audience)
      .setIssuer(issuer)
      .setExpirationTime("1h")
      .encrypt(key);

    await expect(decode(token)).rejects.toThrow(/not allowed/);
  });

  it("throws without the chat key", async () => {
    const secret = process.env.CHAT_IDENTITY_KEY;
    vi.stubEnv("CHAT_IDENTITY_KEY", "");
    vi.resetModules();

    await expect(import("../../utils/chat")).rejects.toThrow("missing chat key");

    vi.stubEnv("CHAT_IDENTITY_KEY", secret);
    vi.resetModules();
  });
});
