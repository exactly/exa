import "../expect";

import "../mocks/redis";
import customer from "../mocks/sardine";
import "../mocks/sentry";

import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { decodeJwt } from "jose";
import assert from "node:assert";
import { parse, type InferOutput } from "valibot";
import { zeroAddress } from "viem";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import app, { type Authentication } from "../../api/auth/authentication";
import database, { credentials } from "../../database";
import * as publicClient from "../../utils/publicClient";

import type * as SimpleWebAuthn from "@simplewebauthn/server";
import type * as SimpleWebAuthnHelpers from "@simplewebauthn/server/helpers";
import type * as ViemSiwe from "viem/siwe";

const appClient = testClient(app);

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
  });

  it("returns 400 if the siwe message is invalid", async () => {
    vi.spyOn(publicClient.default, "verifySiweMessage").mockResolvedValue(false);
    const id = "0xaBcDef1234567890123456789012345678901234";

    const response = await appClient.index.$post(
      { json: { method: "siwe", id, signature: "0xdeadbeef" } },
      { headers: { cookie: "session_id=test-session" } },
    );
    expect(response.status).toBe(400);
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
  };
});

vi.mock("../../utils/redis", () => ({
  default: {
    get: vi.fn<() => string>().mockResolvedValue("test-challenge"),
    set: vi.fn<() => boolean>().mockResolvedValue(true),
    del: vi.fn<() => boolean>().mockResolvedValue(true),
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
