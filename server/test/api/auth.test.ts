import "../expect";

import "../mocks/redis";
import customer from "../mocks/sardine";
import "../mocks/sentry";

import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { decodeJwt } from "jose";
import assert from "node:assert";
import { parse, type InferOutput } from "valibot";
import { getAddress, padHex, zeroAddress } from "viem";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import * as derive from "@exactly/common/deriveAddress";
import chain, { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import app, { type Authentication } from "../../api/auth/authentication";
import registrationApp from "../../api/auth/registration";
import database, { credentials } from "../../database";
import * as publicClient from "../../utils/publicClient";
import redis from "../../utils/redis";
import validFactories from "../../utils/validFactories";

import type * as SimpleWebAuthn from "@simplewebauthn/server";
import type * as SimpleWebAuthnHelpers from "@simplewebauthn/server/helpers";
import type * as ViemSiwe from "viem/siwe";

const appClient = testClient(app);
const registrationAppClient = testClient(registrationApp);

describe("authentication", () => {
  beforeAll(async () => {
    await database.insert(credentials).values([
      {
        id: "dGVzdC1jcmVkLWlk",
        publicKey: new Uint8Array(),
        account: zeroAddress,
        factory: parse(Address, inject("ExaAccountFactory")),
        counter: 0,
        transports: [],
      },
    ]);
  });

  afterEach(() => vi.clearAllMocks());

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
        query: {},
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);

    const json = await response.json();
    const authResponse = json as InferOutput<typeof Authentication>;

    assert.ok(authResponse.intercomToken);

    const payload = decodeJwt(authResponse.intercomToken);
    const nowInSeconds = Math.floor(Date.now() / 1000);

    expect(payload.user_id).toBe(zeroAddress);
    expect(payload.sub).toBe(zeroAddress);
    expect(payload.exp).toBeGreaterThan(nowInSeconds + 86_000);
    expect(payload.exp).toBeLessThan(nowInSeconds + 86_500);
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
  });

  it("returns 400 if authentication challenge is missing", async () => {
    vi.mocked(redis).getdel.mockResolvedValueOnce(null);

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
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
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
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
  });

  it("consumes challenge after failed authentication to prevent replay", async () => {
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);

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
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);
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
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: false,
      authenticationInfo: { credentialID: "dGVzdC1jcmVkLWlk", newCounter: 1 },
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
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { credentialID: "another-credential", newCounter: 1 },
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
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);
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
      { json: { method: "siwe", id, signature: "0xdeadbeef" }, query: {} },
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
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
  });

  it("creates a credential using siwe", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(true);
    const id = "0xaBcDef1234567890123456789012345678901234";

    const response = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" }, query: {} },
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
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
  });

  it("returns 400 if the siwe message is invalid", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(false);
    const id = "0xaBcDef1234567890123456789012345678901234";

    const response = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" }, query: {} },
      { headers: { cookie: "session_id=test-session" } },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ code: "bad authentication" }));
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
  });

  it("consumes challenge after failed siwe authentication to prevent replay", async () => {
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);
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
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
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
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
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
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
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
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
  });
});

describe("registration", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 400 if registration challenge is missing", async () => {
    vi.mocked(redis).getdel.mockResolvedValueOnce(null);
    const response = await postRegistrationWebauthn();

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ code: "no registration" }));
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
  });

  it("consumes challenge before verifier exceptions", async () => {
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);
    vi.mocked(verifyRegistrationResponse).mockRejectedValueOnce(new Error("boom"));

    const firstResponse = await postRegistrationWebauthn();
    const secondResponse = await postRegistrationWebauthn();

    expect(firstResponse.status).toBe(500);
    expect(await firstResponse.json()).toEqual(expect.objectContaining({ code: "ouch" }));
    expect(secondResponse.status).toBe(400);
    expect(await secondResponse.json()).toEqual(expect.objectContaining({ code: "no registration" }));
  });

  it("consumes challenge after bad registration to prevent replay", async () => {
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);
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
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: "another-credential",
          publicKey: new Uint8Array(65),
          counter: 0,
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
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: "dGVzdC1jcmVkLWlk2",
          publicKey: new Uint8Array(65),
          counter: 0,
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
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);
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
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
  });

  it("consumes challenge after failed siwe registration to prevent replay", async () => {
    vi.mocked(redis).getdel.mockResolvedValueOnce("test-challenge").mockResolvedValueOnce(null);
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
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
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
    expect(vi.mocked(redis).getdel.mock.calls).toContainEqual(["test-session"]);
  });
});

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof SimpleWebAuthn>();
  return {
    ...actual,
    verifyAuthenticationResponse: vi
      .fn<() => Promise<{ authenticationInfo: { credentialID: string; newCounter: number }; verified: boolean }>>()
      .mockResolvedValue({
        verified: true,
        authenticationInfo: { credentialID: "dGVzdC1jcmVkLWlk", newCounter: 1 },
      }),
    verifyRegistrationResponse: vi
      .fn<
        (options: { response: { id: string } }) => Promise<{
          registrationInfo: {
            credential: { counter: number; id: string; publicKey: Uint8Array; transports: string[] };
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
              counter: 0,
              transports: ["internal"],
            },
            credentialDeviceType: "multiDevice",
          },
        }),
      ),
  };
});

vi.mock("../../utils/redis", () => ({
  default: {
    getdel: vi.fn<() => Promise<null | string>>().mockResolvedValue("test-challenge"),
    set: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  },
}));

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
