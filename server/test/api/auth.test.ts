import "../expect";

import customer from "../mocks/sardine";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import assert from "node:assert";
import { parse, type InferOutput } from "valibot";
import { getAddress, padHex, zeroAddress } from "viem";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

import * as derive from "@exactly/common/deriveAddress";
import chain, { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import app, { Authentication } from "../../api/auth/authentication";
import registrationApp from "../../api/auth/registration";
import database, { credentials } from "../../database";
import authSecret from "../../utils/authSecret";
import * as publicClient from "../../utils/publicClient";
import redis from "../../utils/redis";
import validFactories from "../../utils/validFactories";
import { verifyToken } from "../../utils/walletExtension";

import type * as SimpleWebAuthn from "@simplewebauthn/server";
import type * as SimpleWebAuthnHelpers from "@simplewebauthn/server/helpers";
import type * as ViemSiwe from "viem/siwe";

const appClient = testClient(app);
const registrationAppClient = testClient(registrationApp);
const WALLET_EXTENSION_EXPIRY = 60 * 24 * 60 * 60_000;

vi.mock("@sentry/node", { spy: true });

function expectWalletExtensionExpire(expire: number, auth: number, start: number) {
  expect(expire).toBeGreaterThan(auth);
  expect(expire).toBeGreaterThan(start + WALLET_EXTENSION_EXPIRY - 1000);
  expect(expire).toBeLessThanOrEqual(Date.now() + WALLET_EXTENSION_EXPIRY);
}

describe("authentication", () => {
  beforeAll(async () => {
    await database.insert(credentials).values([
      {
        id: "dGVzdC1jcmVkLWlk",
        publicKey: new Uint8Array(),
        account: zeroAddress,
        factory: parse(Address, inject("ExaAccountFactory")),
        transports: [],
      },
    ]);
  });

  beforeEach(async () => {
    await redis.set("test-session", "test-challenge");
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await redis.del("test-session");
  });

  it("returns intercom token on successful login", async () => {
    const response = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);

    const authResponse = parse(Authentication, await response.json());

    assert.ok(authResponse.intercomToken);

    const payload = decodeJwt(authResponse.intercomToken);
    const nowInSeconds = Math.floor(Date.now() / 1000);

    expect(payload.user_id).toBe(zeroAddress);
    expect(payload.sub).toBe(zeroAddress);
    expect(payload.exp).toBeGreaterThan(nowInSeconds + 86_000);
    expect(payload.exp).toBeLessThan(nowInSeconds + 86_500);
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("returns wallet extension token on ios login", async () => {
    const start = Date.now();
    const response = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session", "Client-Platform": "ios" } },
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    const authResponse = parse(Authentication, json);

    assert.ok(authResponse.walletExtension);
    const { token } = authResponse.walletExtension;
    const payload = decodeJwt(token);
    const header = decodeProtectedHeader(token);
    expectWalletExtensionExpire(authResponse.walletExtension.expire, authResponse.auth, start);
    await expect(verifyToken(token)).resolves.toStrictEqual({
      credentialId: "dGVzdC1jcmVkLWlk",
      scope: "card:provisioning",
    });
    await expect(
      jwtVerify(token, new TextEncoder().encode(authSecret), {
        audience: "wallet-extension",
      }),
    ).rejects.toThrow();
    expect(payload.exp).toBe(Math.floor(authResponse.walletExtension.expire / 1000));
    expect(payload.iss).toBe("exa-server");
    expect(header.alg).toBe("HS256");
  });

  it("captures invalid wallet extension token verification", async () => {
    await expect(verifyToken("invalid")).resolves.toBeNull();

    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.any(Error), { level: "warning" });
  });

  it("rejects short wallet extension secrets", async () => {
    const secret = process.env.WALLET_EXTENSION_SECRET;
    vi.resetModules();
    vi.stubEnv("WALLET_EXTENSION_SECRET", "short");

    await expect(import("../../utils/walletExtension")).rejects.toThrow("wallet extension secret too short for HS256");

    vi.stubEnv("WALLET_EXTENSION_SECRET", secret);
    vi.resetModules();
  });

  it("returns wallet extension token on ios siwe signup", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const id = "0x1234567890123456789012345678901234567888";
    const start = Date.now();
    const response = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session", "Client-Platform": "ios" } },
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    const authResponse = parse(Authentication, json);

    assert.ok(authResponse.walletExtension);
    expectWalletExtensionExpire(authResponse.walletExtension.expire, authResponse.auth, start);
    await expect(verifyToken(authResponse.walletExtension.token)).resolves.toStrictEqual({
      credentialId: id,
      scope: "card:provisioning",
    });
  });

  it("rejects unknown client platform login", async () => {
    const response = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session", "Client-Platform": "desktop" } },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({ code: "bad client platform" });
  });

  it("omits wallet extension token without client platform", async () => {
    const response = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);
    const authResponse = await response.json();

    expect(authResponse).not.toHaveProperty("walletExtension");
  });

  it("returns 400 if authentication challenge is missing", async () => {
    await redis.del("test-session");

    const response = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ code: "no authentication" }));
  });

  it("returns 400 for missing credential with non-siwe assertion", async () => {
    const response = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "bWlzc2luZy1jcmVk", // cspell:ignore Wlzc
          rawId: "bWlzc2luZy1jcmVk", // cspell:ignore Wlzc
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ code: "no credential" }));
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("consumes challenge after failed authentication to prevent replay", async () => {
    const firstResponse = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "bWlzc2luZy1jcmVk", // cspell:ignore Wlzc
          rawId: "bWlzc2luZy1jcmVk", // cspell:ignore Wlzc
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );
    const secondResponse = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "bWlzc2luZy1jcmVk", // cspell:ignore Wlzc
          rawId: "bWlzc2luZy1jcmVk", // cspell:ignore Wlzc
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(firstResponse.status).toBe(400);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "no credential" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no authentication" }));
  });

  it("consumes challenge before verifier exceptions", async () => {
    vi.mocked(verifyAuthenticationResponse).mockRejectedValueOnce(new Error("boom"));

    const firstResponse = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );
    const secondResponse = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(firstResponse.status).toBe(500);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "ouch" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no authentication" }));
  });

  it("consumes challenge after unverified authentication response to prevent replay", async () => {
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: false,
      authenticationInfo: { credentialID: "dGVzdC1jcmVkLWlk" },
    } as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);

    const firstResponse = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );
    const secondResponse = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(firstResponse.status).toBe(400);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "bad authentication" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no authentication" }));
  });

  it("consumes challenge after mismatched authentication credential id to prevent replay", async () => {
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { credentialID: "another-credential" },
    } as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);

    const firstResponse = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );
    const secondResponse = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(firstResponse.status).toBe(400);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "bad authentication" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no authentication" }));
  });

  it("handles exceptions in no-credential siwe authentication path", async () => {
    const { parseSiweMessage } = await import("viem/siwe");
    vi.mocked(parseSiweMessage).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const id = "0x1234567890123456789012345678901234567897";

    const firstResponse = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );
    const secondResponse = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(firstResponse.status).toBe(500);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "ouch" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no authentication" }));
  });

  it("creates a credential with source using siwe", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const id = "0x1234567890123456789012345678901234567890";
    const response = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session", "Client-Fid": "12345" } },
    );

    expect(response.status).toBe(200);

    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: { name: "signup", type: "signup" },
        customer: { id, tags: [{ name: "source", value: "12345", type: "string" }] },
      }),
    );

    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, id),
      columns: { source: true },
    });
    expect(credential?.source).toBe("12345");
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("creates a credential using siwe", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const id = "0xaBcDef1234567890123456789012345678901234";

    const response = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);

    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: { name: "signup", type: "signup" },
        customer: { id, tags: [{ name: "source", value: "EXA", type: "string" }] },
      }),
    );

    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, id),
      columns: { id: true },
    });
    expect(credential?.id).toBe(id);
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("returns 400 if the siwe message is invalid", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(false);
    const id = "0xaBcDef1234567890123456789012345678901234";

    const response = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ code: "bad authentication" }));
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("consumes challenge after failed siwe authentication to prevent replay", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(false);
    const id = "0x1234567890123456789012345678901234567894";

    const firstResponse = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );
    const secondResponse = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(firstResponse.status).toBe(400);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "bad authentication" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no authentication" }));
  });

  it("creates a credential with factory using siwe", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const factory = [...validFactories].find((f) => f !== exaAccountFactoryAddress);
    assert.ok(factory);
    const id = "0xFace000000000000000000000000000000000001";
    const response = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" }, query: { factory } },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);

    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, id),
      columns: { factory: true },
    });
    expect(credential?.factory).toBe(factory);
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("returns 400 for invalid factory using siwe", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const id = "0xFace000000000000000000000000000000000002";
    const response = await appClient.index.$post(
      {
        json: { method: "siwe", id, signature: "0xdeadbeef" },
        query: { factory: getAddress(padHex("0xdead", { size: 20 })) },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ code: "bad factory" }));
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("authenticates existing credential with matching factory", async () => {
    const factory = parse(Address, inject("ExaAccountFactory"));
    const response = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
        query: { factory },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);
    const json = (await response.json()) as InferOutput<typeof Authentication>;
    expect(json.factory).toBe(factory);
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("returns 400 if factory mismatches existing credential", async () => {
    const factory = [...validFactories].find((f) => f !== parse(Address, inject("ExaAccountFactory")));
    assert.ok(factory);
    const response = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
        query: { factory },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(400);
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });
});

describe("registration", () => {
  beforeEach(async () => {
    await redis.set("test-session", "test-challenge");
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await redis.del("test-session");
  });

  it("returns 400 if registration challenge is missing", async () => {
    await redis.del("test-session");
    const response = await postRegistrationWebauthn();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ code: "no registration" }));
  });

  it("consumes challenge before verifier exceptions", async () => {
    vi.mocked(verifyRegistrationResponse).mockRejectedValueOnce(new Error("boom"));

    const firstResponse = await postRegistrationWebauthn();
    const secondResponse = await postRegistrationWebauthn();

    expect(firstResponse.status).toBe(500);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "ouch" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no registration" }));
  });

  it("consumes challenge after bad registration to prevent replay", async () => {
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: false,
    } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);

    const firstResponse = await postRegistrationWebauthn();
    const secondResponse = await postRegistrationWebauthn();

    expect(firstResponse.status).toBe(400);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "bad registration" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no registration" }));
  });

  it("consumes challenge after mismatched registration credential id to prevent replay", async () => {
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: "another-credential",
          publicKey: new Uint8Array(65),
          transports: ["internal"],
        },
        credentialDeviceType: "multiDevice",
      },
    } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);

    const firstResponse = await postRegistrationWebauthn();
    const secondResponse = await postRegistrationWebauthn();

    expect(firstResponse.status).toBe(400);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "bad registration" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no registration" }));
  });

  it("consumes challenge after single-device registration to prevent replay", async () => {
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: "dGVzdC1jcmVkLWlk2",
          publicKey: new Uint8Array(65),
          transports: ["internal"],
        },
        credentialDeviceType: "singleDevice",
      },
    } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);

    const firstResponse = await postRegistrationWebauthn();
    const secondResponse = await postRegistrationWebauthn();

    expect(firstResponse.status).toBe(400);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "backup eligibility required" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no registration" }));
  });

  it("handles exceptions in post-verification registration path", async () => {
    vi.spyOn(derive, "default").mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const firstResponse = await postRegistrationWebauthn();
    const secondResponse = await postRegistrationWebauthn();

    expect(firstResponse.status).toBe(500);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "ouch" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no registration" }));
  });

  it("creates a credential using siwe", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const id = "0x1234567890123456789012345678901234567895";

    const response = await registrationAppClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);
    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: { name: "signup", type: "signup" },
        customer: { id, tags: [{ name: "source", value: "EXA", type: "string" }] },
      }),
    );

    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, id),
      columns: { id: true },
    });
    expect(credential?.id).toBe(id);
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("consumes challenge after failed siwe registration to prevent replay", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(false);
    const id = "0x1234567890123456789012345678901234567896";

    const firstResponse = await registrationAppClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );
    const secondResponse = await registrationAppClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(firstResponse.status).toBe(400);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "bad registration" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no registration" }));
  });

  it("creates a credential with source using webauthn", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567893");
    vi.spyOn(derive, "default").mockReturnValue(account);
    const response = await registrationAppClient.index.$post(
      { json: registrationWebauthnAssertion() },
      { headers: { cookie: "session_id=test-session", "Client-Fid": "12345" } },
    );

    expect(response.status).toBe(200);

    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: { name: "signup", type: "signup" },
        customer: { id: "dGVzdC1jcmVkLWlk2", tags: [{ name: "source", value: "12345", type: "string" }] },
      }),
    );

    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, "dGVzdC1jcmVkLWlk2"),
      columns: { source: true },
    });
    expect(credential?.source).toBe("12345");
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("returns wallet extension token on ios webauthn registration", async () => {
    const id = "aW9zLXJlZ2lzdHJhdGlvbg"; // cspell:ignore Glvbg
    const account = parse(Address, "0x1234567890123456789012345678901234567894");
    vi.spyOn(derive, "default").mockReturnValue(account);
    const start = Date.now();
    const response = await registrationAppClient.index.$post(
      { json: registrationWebauthnAssertion({ id, rawId: id }) },
      { headers: { cookie: "session_id=test-session", "Client-Platform": "ios" } },
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    const authResponse = parse(Authentication, json);

    assert.ok(authResponse.walletExtension);
    expectWalletExtensionExpire(authResponse.walletExtension.expire, authResponse.auth, start);
    await expect(verifyToken(authResponse.walletExtension.token)).resolves.toStrictEqual({
      credentialId: id,
      scope: "card:provisioning",
    });
  });

  it("omits wallet extension token without client platform webauthn registration", async () => {
    const id = "bm8tcGxhdGZvcm0tcmVnaXN0cmF0aW9u"; // cspell:ignore bm8tcGxhdGZvcm0tcmVnaXN0cmF0aW9u
    const account = parse(Address, "0x1234567890123456789012345678901234567897");
    vi.spyOn(derive, "default").mockReturnValue(account);
    const response = await registrationAppClient.index.$post(
      { json: registrationWebauthnAssertion({ id, rawId: id }) },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).not.toHaveProperty("walletExtension");
  });

  it("rejects unknown client platform webauthn registration", async () => {
    const id = "ZGVza3RvcC1yZWdpc3RyYXRpb24"; // cspell:ignore ZGVza3RvcC1yZWdpc3RyYXRpb24
    const account = parse(Address, "0x1234567890123456789012345678901234567898");
    vi.spyOn(derive, "default").mockReturnValue(account);
    const response = await registrationAppClient.index.$post(
      { json: registrationWebauthnAssertion({ id, rawId: id }) },
      { headers: { cookie: "session_id=test-session", "Client-Platform": "desktop" } },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({ code: "bad client platform" });
  });

  it("creates a credential using webauthn", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567892");
    vi.spyOn(derive, "default").mockReturnValue(account);
    const response = await postRegistrationWebauthn({
      id: "YW5vdGhlci1jcmVkLWlk2", // cspell:ignore YW5vdGhlci1jcmVkLWlk2
      rawId: "YW5vdGhlci1jcmVkLWlk2",
    });

    expect(response.status).toBe(200);

    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: { name: "signup", type: "signup" },
        customer: { id: "YW5vdGhlci1jcmVkLWlk2", tags: [{ name: "source", value: "EXA", type: "string" }] },
      }),
    );
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, "YW5vdGhlci1jcmVkLWlk2"),
      columns: { source: true },
    });
    expect(credential).toBeDefined();
    expect(credential?.source).toBeNull();
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });
});

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof SimpleWebAuthn>();
  return {
    ...actual,
    verifyAuthenticationResponse: vi
      .fn<() => Promise<{ authenticationInfo: { credentialID: string }; verified: boolean }>>()
      .mockResolvedValue({
        verified: true,
        authenticationInfo: { credentialID: "dGVzdC1jcmVkLWlk" },
      }),
    verifyRegistrationResponse: vi
      .fn<
        (options: { response: { id: string } }) => Promise<{
          registrationInfo: {
            credential: { id: string; publicKey: Uint8Array; transports: string[] };
            credentialDeviceType: string;
          };
          verified: boolean;
        }>
      >()
      .mockImplementation((options: { response: { id: string } }) =>
        Promise.resolve({
          verified: true,
          registrationInfo: {
            credential: {
              id: options.response.id,
              publicKey: new Uint8Array(65),
              transports: ["internal"],
            },
            credentialDeviceType: "multiDevice",
          },
        }),
      ),
  };
});

vi.mock("@simplewebauthn/server/helpers", async (importOriginal) => {
  const original = await importOriginal<typeof SimpleWebAuthnHelpers>();
  return {
    ...original,
    decodeCredentialPublicKey: vi.fn<() => Map<number, number | Uint8Array>>().mockReturnValue(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(32)],
        [-3, new Uint8Array(32)],
      ]),
    ),
    cose: { ...original.cose, isCOSEPublicKeyEC2: () => true, COSEKEYS: { x: -2, y: -3 } },
  };
});

vi.mock("viem/siwe", async (importOriginal) => {
  const original = await importOriginal<typeof ViemSiwe>();
  return {
    ...original,
    validateSiweMessage: vi.fn<() => boolean>().mockReturnValue(true),
    parseSiweMessage: vi.fn<() => ViemSiwe.SiweMessage>().mockReturnValue({
      address: zeroAddress,
      chainId: chain.id,
      domain: "localhost",
      nonce: "test-nonce",
      uri: "http://localhost",
      version: "1",
    }),
  };
});

type RegistrationWebauthnAssertion = {
  clientExtensionResults: Record<string, never>;
  id: string;
  rawId: string;
  response: { attestationObject: string; clientDataJSON: string; transports: string[] };
  type: "public-key";
};

type RegistrationWebauthnAssertionOverride = Partial<Omit<RegistrationWebauthnAssertion, "response">> & {
  response?: Partial<RegistrationWebauthnAssertion["response"]>;
};

function registrationWebauthnAssertion(
  override: RegistrationWebauthnAssertionOverride = {},
): RegistrationWebauthnAssertion {
  const base: RegistrationWebauthnAssertion = {
    id: "dGVzdC1jcmVkLWlk2",
    rawId: "dGVzdC1jcmVkLWlk2",
    response: { clientDataJSON: "dGVzdA", attestationObject: "dGVzdA", transports: ["internal"] },
    clientExtensionResults: {},
    type: "public-key",
  };
  return { ...base, ...override, response: { ...base.response, ...override.response } };
}

function postRegistrationWebauthn(override: RegistrationWebauthnAssertionOverride = {}) {
  return registrationAppClient.index.$post(
    { json: registrationWebauthnAssertion(override) },
    { headers: { cookie: "session_id=test-session" } },
  );
}
