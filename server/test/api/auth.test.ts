import "../expect";

import customer from "../mocks/sardine";
import "../mocks/segment";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import assert from "node:assert";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string, type InferOutput } from "valibot";
import { getAddress, keccak256, padHex, slice, toBytes, zeroAddress } from "viem";
import { optimism } from "viem/chains";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, onTestFinished, vi } from "vitest";

import * as derive from "@exactly/common/deriveAddress";
import chain, { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import authentication, { Authentication } from "../../api/auth/authentication";
import registration from "../../api/auth/registration";
import database, { credentials } from "../../database";
import authSecret from "../../utils/authSecret";
import createCredentialFactory from "../../utils/createCredential";
import createIntercom from "../../utils/intercom";
import * as publicClient from "../../utils/publicClient";
import redis from "../../utils/redis";
import createSardine from "../../utils/sardine";
import createSegment from "../../utils/segment";
import validFactories from "../../utils/validFactories";
import createWalletExtension from "../../utils/walletExtension";

import type createSubscribe from "../../workers/subscribe/queue";
import type * as SimpleWebAuthn from "@simplewebauthn/server";
import type * as SimpleWebAuthnHelpers from "@simplewebauthn/server/helpers";
import type * as ViemSiwe from "viem/siwe";

const WALLET_EXTENSION_EXPIRY = 60 * 24 * 60 * 60_000;

vi.mock("@sentry/node", { spy: true });

const walletExtension = createWalletExtension(parse(pipe(string(), nonEmpty()), env.WALLET_EXTENSION_SECRET));
const subscribe = {
  close: vi.fn<ReturnType<typeof createSubscribe>["close"]>().mockResolvedValue(),
  enqueue: vi.fn<ReturnType<typeof createSubscribe>["enqueue"]>().mockResolvedValue(),
};
const createCredential = createCredentialFactory({
  authSecret,
  database,
  sardine: createSardine(
    parse(pipe(string(), nonEmpty()), env.SARDINE_API_KEY),
    parse(pipe(string(), nonEmpty()), env.SARDINE_API_URL),
  ),
  segment: createSegment(parse(pipe(string(), nonEmpty()), env.SEGMENT_WRITE_KEY)),
  subscribe,
});
const intercom = createIntercom(parse(pipe(string(), nonEmpty()), env.INTERCOM_IDENTITY_KEY));
const appClient = testClient(
  authentication({ authSecret, createCredential, database, intercom, redis, walletExtension }),
);
const registrationAppClient = testClient(registration({ createCredential, intercom, redis, walletExtension }));

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
      { headers: { cookie: "session_id=test-session", "do-connecting-ip": "203.0.113.42" } },
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
    expect(customer).not.toHaveBeenCalled();
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
    await expect(walletExtension.verify(token)).resolves.toStrictEqual({
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
    await expect(walletExtension.verify("invalid")).resolves.toBeNull();

    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.any(Error), { level: "warning" });
  });

  it("rejects short wallet extension secrets", () => {
    expect(() => createWalletExtension("short")).toThrow("wallet extension secret too short for HS256");
  });

  it("returns wallet extension token on ios siwe signup", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const id = own(parse(Address, slice(keccak256(toBytes("auth:ios-siwe-signup")), 12)));
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
    await expect(walletExtension.verify(authResponse.walletExtension.token)).resolves.toStrictEqual({
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

  it("rejects malformed structured authentication challenges", async () => {
    await redis.set("test-session", JSON.stringify({ accountType: "business" }));

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
    await expect(response.json()).resolves.toStrictEqual({ code: "bad authentication", legacy: "bad authentication" });
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("rejects account type mismatch between challenge and request", async () => {
    await redis.set("test-session", JSON.stringify({ challenge: "test-challenge", accountType: "business" }));

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
    await expect(response.json()).resolves.toStrictEqual({ code: "bad account type" });
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("rejects business auth for a credential without business salt", async () => {
    await redis.set("test-session", JSON.stringify({ challenge: "test-challenge", accountType: "business" }));

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
        query: { accountType: "business" },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({ code: "bad account type" });
    await expect(redis.exists("test-session")).resolves.toBe(0);
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

  it("creates a credential with source and ip using siwe", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const id = own(parse(Address, slice(keccak256(toBytes("auth:siwe-source-ip")), 12)));
    const response = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      {
        headers: {
          cookie: "session_id=test-session",
          "Client-Fid": "12345",
          "do-connecting-ip": "203.0.113.42",
        },
      },
    );

    expect(response.status).toBe(200);

    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: { name: "signup", type: "signup" },
        customer: {
          id,
          tags: [
            { name: "source", value: "12345", type: "string" },
            { name: "auth_method", value: "siwe", type: "string" },
          ],
        },
        device: { ip: "203.0.113.42" },
      }),
    );

    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, id),
      columns: { source: true },
    });
    expect(credential?.source).toBe("12345");
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("omits an invalid signup ip from Sardine", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const id = own(parse(Address, slice(keccak256(toBytes("auth:siwe-invalid-ip")), 12)));

    const response = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session", "do-connecting-ip": "not-an-ip" } },
    );

    expect(response.status).toBe(200);
    expect(customer).toHaveBeenCalledWith({
      flow: { name: "signup", type: "signup" },
      customer: {
        id,
        tags: [
          { name: "source", value: "EXA", type: "string" },
          { name: "auth_method", value: "siwe", type: "string" },
        ],
      },
    });
  });

  it("creates a credential using siwe", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const id = own(parse(Address, slice(keccak256(toBytes("auth:siwe-authentication")), 12)));

    const response = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);

    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: { name: "signup", type: "signup" },
        customer: {
          id,
          tags: [
            { name: "source", value: "EXA", type: "string" },
            { name: "auth_method", value: "siwe", type: "string" },
          ],
        },
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
    const id = own(parse(Address, slice(keccak256(toBytes("auth:siwe-factory")), 12)));
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
    const id = own(parse(Address, slice(keccak256(toBytes("auth:siwe-registration")), 12)));

    const response = await registrationAppClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);
    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: { name: "signup", type: "signup" },
        customer: {
          id,
          tags: [
            { name: "source", value: "EXA", type: "string" },
            { name: "auth_method", value: "siwe", type: "string" },
          ],
        },
      }),
    );

    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, id),
      columns: { id: true },
    });
    expect(credential?.id).toBe(id);
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("rejects siwe registration on optimism", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const id = "0x1234567890123456789012345678901234567899";
    const chainId = chain.id;
    onTestFinished(() => {
      chain.id = chainId;
    });
    chain.id = optimism.id;

    const response = await registrationAppClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toStrictEqual({ code: "ouch", legacy: "ouch" });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "siwe registration disabled" }),
      { level: "error", tags: { unhandled: true } },
    );
    expect(customer).not.toHaveBeenCalled();
    await expect(
      database.query.credentials.findFirst({ where: eq(credentials.id, id), columns: { id: true } }),
    ).resolves.toBeUndefined();
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

  it.each([
    ["203.0.113.42", "dGVzdC1jcmVkLWlk2"],
    ["2001:db8::42", "aXB2Ni1jcmVkLWlk"],
  ])("creates a credential using webauthn from %s", async (ip, id) => {
    own(id);
    vi.spyOn(derive, "default").mockReturnValue(parse(Address, slice(keccak256(toBytes(`auth:${id}`)), 12)));
    const response = await registrationAppClient.index.$post(
      { json: registrationWebauthnAssertion({ id, rawId: id }) },
      {
        headers: {
          cookie: "session_id=test-session",
          "Client-Fid": "12345",
          "do-connecting-ip": ip,
        },
      },
    );

    expect(response.status).toBe(200);

    expect(customer).toHaveBeenCalledWith({
      flow: { name: "signup", type: "signup" },
      customer: {
        id,
        tags: [
          { name: "source", value: "EXA", type: "string" },
          { name: "auth_method", value: "webauthn", type: "string" },
        ],
      },
      device: { ip },
    });

    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, id),
      columns: { source: true },
    });
    expect(credential?.source).toBeNull();
    await expect(redis.exists("test-session")).resolves.toBe(0);
  });

  it("omits an invalid signup ip from Sardine", async () => {
    const id = own("aW52YWxpZC1pcC1pZA");
    vi.spyOn(derive, "default").mockReturnValue(parse(Address, slice(keccak256(toBytes(`auth:${id}`)), 12)));
    const response = await registrationAppClient.index.$post(
      { json: registrationWebauthnAssertion({ id, rawId: id }) },
      { headers: { cookie: "session_id=test-session", "do-connecting-ip": "not-an-ip" } },
    );

    expect(response.status).toBe(200);
    expect(customer).toHaveBeenCalledWith({
      flow: { name: "signup", type: "signup" },
      customer: {
        id,
        tags: [
          { name: "source", value: "EXA", type: "string" },
          { name: "auth_method", value: "webauthn", type: "string" },
        ],
      },
    });
  });

  it("does not return wallet extension token on ios webauthn registration", async () => {
    const id = own("aW9zLXJlZ2lzdHJhdGlvbg"); // cspell:ignore Glvbg
    vi.spyOn(derive, "default").mockReturnValue(parse(Address, slice(keccak256(toBytes(`auth:${id}`)), 12)));
    const response = await registrationAppClient.index.$post(
      { json: registrationWebauthnAssertion({ id, rawId: id }) },
      { headers: { cookie: "session_id=test-session", "Client-Platform": "ios" } },
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    const authResponse = parse(Authentication, json);

    assert.ok(!authResponse.walletExtension);
  });

  it("omits wallet extension token without client platform webauthn registration", async () => {
    const id = own("bm8tcGxhdGZvcm0tcmVnaXN0cmF0aW9u"); // cspell:ignore bm8tcGxhdGZvcm0tcmVnaXN0cmF0aW9u
    vi.spyOn(derive, "default").mockReturnValue(parse(Address, slice(keccak256(toBytes(`auth:${id}`)), 12)));
    const response = await registrationAppClient.index.$post(
      { json: registrationWebauthnAssertion({ id, rawId: id }) },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).not.toHaveProperty("walletExtension");
  });

  it("rejects unknown client platform webauthn registration", async () => {
    const id = own("ZGVza3RvcC1yZWdpc3RyYXRpb24"); // cspell:ignore ZGVza3RvcC1yZWdpc3RyYXRpb24
    vi.spyOn(derive, "default").mockReturnValue(parse(Address, slice(keccak256(toBytes(`auth:${id}`)), 12)));
    const response = await registrationAppClient.index.$post(
      { json: registrationWebauthnAssertion({ id, rawId: id }) },
      { headers: { cookie: "session_id=test-session", "Client-Platform": "desktop" } },
    );

    expect(response.status).toBe(200);
  });

  it("creates a credential using webauthn", async () => {
    const id = own("YW5vdGhlci1jcmVkLWlk2"); // cspell:ignore YW5vdGhlci1jcmVkLWlk2
    vi.spyOn(derive, "default").mockReturnValue(parse(Address, slice(keccak256(toBytes(`auth:${id}`)), 12)));
    const response = await postRegistrationWebauthn({
      id,
      rawId: id,
    });

    expect(response.status).toBe(200);

    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: { name: "signup", type: "signup" },
        customer: {
          id,
          tags: [
            { name: "source", value: "EXA", type: "string" },
            { name: "auth_method", value: "webauthn", type: "string" },
          ],
        },
      }),
    );
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, id),
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

function own<T extends string>(id: T) {
  onTestFinished(async () => {
    await database.delete(credentials).where(eq(credentials.id, id));
  });
  return id;
}
